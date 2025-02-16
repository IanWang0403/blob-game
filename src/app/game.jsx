/* eslint-disable */

"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";

// --- Constants ---
const gridSize = 100; // grid is 100 x 100 cells
const cellSize = 10; // each cell is 10x10 pixels (total canvas: 1000x1000)
const canvasSize = gridSize * cellSize;
const simulationInterval = 2000; // 2000ms = 2 seconds per step
const maxStepsWithoutFood = 100;
const initialBlobCount = 100;
const initialFoodCount = 100;

// Terrain colors
const terrainColors = {
  soil: "#8B4513",
  sand: "#F4A460",
  water: "#1E90FF",
};

// Colors for game objects
const blobColor = "red";
const foodColor = "green";

// --- Helper Functions ---

// --- Terrain Generation ---
//
// This function “grows” the terrain starting from a seed cell (center)
// using a flood-fill approach. Each cell generates all its adjacent empty cells
// (neighbors in all 8 directions) based on the parent's type and a chain value.
//
// For a parent of type:
// - 'soil': first cell (chain 1) always produces soil (100%).
//           For subsequent cells, the probability to produce soil is
//           (100 - (chain - 1))%, otherwise the cell becomes sand (chain resets to 1).
//           (Once a sand is produced, that branch stops generating soil.)
// - 'sand': first cell (chain 1) always produces sand.
//           Then the chance to continue sand is (100 - (chain - 1)*5)%
//           (e.g. 95% for chain 2, 90% for chain 3, etc.). On failure, water is produced.
//           (Once water is produced, that branch stops generating sand.)
// - 'water': always generates water.
function generateGrid() {
  // Create empty grid (null indicates not yet assigned)
  const grid = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill(null)
  );

  // We'll keep a chain grid to record how many consecutive cells of the same type we've generated.
  const chainGrid = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill(0)
  );

  // Pick a start cell (e.g. center) and set it to soil.
  const startX = Math.floor(gridSize / 2);
  const startY = Math.floor(gridSize / 2);
  grid[startY][startX] = "soil";
  chainGrid[startY][startX] = 1;

  // The frontier is an array of cells we still need to expand from.
  // Each entry has x, y, type, chain.
  const frontier = [{ x: startX, y: startY, type: "soil", chain: 1 }];

  // We include diagonals to expand in all 8 directions.
  // If you want to reduce diagonal patterns further, remove the diagonal entries.
  const directions = [
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ];

  // Keep expanding until the frontier is empty (i.e., all cells are assigned).
  while (frontier.length > 0) {
    // 1) Pick a random cell from the frontier instead of always taking the front.
    const randomIndex = Math.floor(Math.random() * frontier.length);
    const current = frontier[randomIndex];
    frontier.splice(randomIndex, 1);

    const { x, y, type, chain } = current;

    // 2) Shuffle the directions so we expand neighbors in a random order.
    for (let i = directions.length - 1; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      [directions[i], directions[r]] = [directions[r], directions[i]];
    }

    // 3) Expand neighbors in the shuffled order.
    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;

      // Skip out-of-bounds or already assigned cells.
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      if (grid[ny][nx] !== null) continue;

      let newType, newChain;

      // Apply the chain logic:
      // Soil:
      //   - If chain == 1 => 100% soil
      //   - Else => p = (100 - (chain - 1))%
      //   - On failure => sand
      // Sand:
      //   - If chain == 1 => 100% sand
      //   - Else => p = (100 - (chain - 1)*5)%
      //   - On failure => water
      // Water => always water
      if (type === "soil") {
        const probability = Math.max(100 - (chain - 1) * 0.5, 0) / 100;
        if (Math.random() < probability) {
          newType = "soil";
          newChain = chain + 1;
        } else {
          newType = "sand";
          newChain = 1;
        }
      } else if (type === "sand") {
        const probability = Math.max(100 - (chain - 1) * 5, 0) / 100;
        if (Math.random() < probability) {
          newType = "sand";
          newChain = chain + 1;
        } else {
          newType = "water";
          newChain = 1;
        }
      } else {
        // Parent is water => always water
        newType = "water";
        newChain = chain + 1;
      }

      // Assign the new cell and add it to the frontier
      grid[ny][nx] = newType;
      chainGrid[ny][nx] = newChain;
      frontier.push({ x: nx, y: ny, type: newType, chain: newChain });
    }
  }

  return grid;
}

/**
 * Generate food positions – only on cells that are "soil"
 */
function generateFood(grid) {
  const food = [];
  let attempts = 0;
  while (food.length < initialFoodCount && attempts < 10000) {
    const x = Math.floor(Math.random() * gridSize);
    const y = Math.floor(Math.random() * gridSize);
    if (grid[y][x] === "soil" && !food.some((f) => f.x === x && f.y === y)) {
      food.push({ x, y });
    }
    attempts++;
  }
  return food;
}

/**
 * Generate blob starting positions (blobs can start anywhere)
 */
function generateBlobs(grid) {
  const blobs = [];
  let attempts = 0;
  while (blobs.length < initialBlobCount && attempts < 10000) {
    const x = Math.floor(Math.random() * gridSize);
    const y = Math.floor(Math.random() * gridSize);
    if (grid[y][x] === "soil" && !blobs.some((f) => f.x === x && f.y === y)) {
      blobs.push({ x, y });
    }
    attempts++;
  }
  return blobs;
}

// --- Main Game Component ---
function Game() {
  const canvasRef = useRef(null);

  // Create the terrain grid only once.
  const grid = useMemo(() => generateGrid(), []);

  // Combine food and blob state into one simulation state.
  const [simState, setSimState] = useState({
    food: generateFood(grid),
    blobs: generateBlobs(grid),
  });

  // Simulation tick: update blobs (and food) every 2 seconds.
  useEffect(() => {
    const interval = setInterval(() => {
      setSimState((prevState) => {
        let newFood = [...prevState.food];
        const newBlobs = prevState.blobs
          .map((blob) => {
            let { x, y, stepsSinceMeal } = blob;

            // --- Step 1. If current cell has food, eat it and reset hunger.
            const foodIndexAtCurrent = newFood.findIndex(
              (f) => f.x === x && f.y === y
            );
            if (foodIndexAtCurrent !== -1) {
              newFood.splice(foodIndexAtCurrent, 1);
              return { x, y, stepsSinceMeal: 0 };
            }

            // --- Step 2. Determine all valid neighbor moves.
            const neighbors = [];
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const newX = x + dx;
                const newY = y + dy;
                if (
                  newX >= 0 &&
                  newX < gridSize &&
                  newY >= 0 &&
                  newY < gridSize
                ) {
                  neighbors.push({ dx, dy });
                }
              }
            }

            // --- Step 3. Check if any neighbor has food.
            const foodNeighbors = neighbors.filter((move) => {
              const targetX = x + move.dx;
              const targetY = y + move.dy;
              return newFood.some((f) => f.x === targetX && f.y === targetY);
            });

            let chosenMove;
            if (foodNeighbors.length > 0) {
              // Move toward one of the adjacent food cells.
              chosenMove =
                foodNeighbors[Math.floor(Math.random() * foodNeighbors.length)];
            } else {
              // No food detected within 1 unit: move randomly.
              chosenMove =
                neighbors[Math.floor(Math.random() * neighbors.length)];
            }
            const newX = x + chosenMove.dx;
            const newY = y + chosenMove.dy;

            // --- Step 4. After moving, if there is food in the new cell, eat it.
            const foodIndexAtNew = newFood.findIndex(
              (f) => f.x === newX && f.y === newY
            );
            if (foodIndexAtNew !== -1) {
              newFood.splice(foodIndexAtNew, 1);
              return { x: newX, y: newY, stepsSinceMeal: 0 };
            } else {
              // No food eaten – increment the hunger counter.
              return { x: newX, y: newY, stepsSinceMeal: stepsSinceMeal + 1 };
            }
          })
          // Remove blobs that have gone 100 steps without eating.
          .filter((blob) => blob.stepsSinceMeal < maxStepsWithoutFood);

        return {
          food: newFood,
          blobs: newBlobs,
        };
      });
    }, simulationInterval);

    return () => clearInterval(interval);
  }, []);

  // Draw the current state to the canvas whenever the simulation state changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Clear the canvas.
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Draw the terrain grid.
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        ctx.fillStyle = terrainColors[grid[y][x]];
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    // Draw food as green circles.
    simState.food.forEach((f) => {
      ctx.fillStyle = foodColor;
      const centerX = f.x * cellSize + cellSize / 2;
      const centerY = f.y * cellSize + cellSize / 2;
      const radius = cellSize / 4;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Draw blobs as red circles.
    simState.blobs.forEach((blob) => {
      ctx.fillStyle = blobColor;
      const centerX = blob.x * cellSize + cellSize / 2;
      const centerY = blob.y * cellSize + cellSize / 2;
      const radius = cellSize / 3;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [simState, grid]);

  return (
    <div className="flex">
      <canvas
        ref={canvasRef}
        width={canvasSize}
        height={canvasSize}
        style={{ border: "1px solid black" }}
      />
      <div>
        <div>Blobs remaining: {simState.blobs.length}</div>
        <div>Food remaining: {simState.food.length}</div>
      </div>
    </div>
  );
}

export default Game;
