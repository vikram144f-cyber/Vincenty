import { describe, expect, it } from 'vitest';
import { createGrid } from '@/lib/astar';

describe('fallback A* grid', () => {
  it('treats the antimeridian as adjacent longitude', () => {
    const grid = createGrid(5, 5, [
      { lat: 0, lng: 179.5, radius: 0.1, intensity: 5 },
    ]);

    expect(grid[18][0].cost).toBeGreaterThan(1);
  });

  it('uses the capped weather cost model shared with the backend', () => {
    const grid = createGrid(5, 5, [
      { lat: 0, lng: 0, radius: 0.1, intensity: 5 },
    ]);

    expect(grid[18][36].cost).toBeCloseTo(2.5, 5);
  });
});
