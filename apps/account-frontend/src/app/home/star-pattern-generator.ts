// Simplified Star Pattern Generator
// Generates consistent star patterns using seeded random number generation

export interface StarConfig {
  size: number;
  opacity: number;
  x: number;
  y: number;
  twinkleDelay: number;
  twinkleDuration: number;
  twinkleAnimation: number;
  shouldTwinkle: boolean;
}

export interface StarPatternConfig {
  width: number;
  height: number;
  minSize: number;
  maxSize: number;
  minOpacity: number;
  maxOpacity: number;
  seed?: number;
}

export class StarPatternGenerator {
  private static currentSeed = 12345;

  private static seededRandom(): number {
    this.currentSeed = (this.currentSeed * 1664525 + 1013904223) % 4294967296;
    return this.currentSeed / 4294967296;
  }

  private static setSeed(seed: number): void {
    this.currentSeed = seed;
  }

  private static randomBetween(min: number, max: number): number {
    return Math.floor(this.seededRandom() * (max - min + 1)) + min;
  }

  private static randomFloat(min: number, max: number): number {
    return min + this.seededRandom() * (max - min);
  }

  /**
   * Generates stars using region-based grid pattern with seeded randomness
   */
  static generateStars(config: StarPatternConfig): StarConfig[] {
    this.setSeed(config.seed || 12345);

    const stars: StarConfig[] = [];
    const density = 3000; // Slightly higher density for better coverage
    const gridSize = Math.sqrt(density);

    // Generate stars on a grid pattern with better randomness
    for (let gridX = 0; gridX < config.width; gridX += gridSize) {
      for (let gridY = 0; gridY < config.height; gridY += gridSize) {
        // Use continuous seeded random instead of resetting seed
        // This prevents vertical patterns

        // Skip some positions to vary density
        if (this.seededRandom() > 0.4) continue;

        // Random position within grid cell
        const offsetX = this.seededRandom() * gridSize;
        const offsetY = this.seededRandom() * gridSize;
        const x = gridX + offsetX;
        const y = gridY + offsetY;

        // Generate star properties
        const isBrightStar = this.seededRandom() < 0.05;
        const size = isBrightStar
          ? Math.min(config.maxSize + 1, 3)
          : this.randomBetween(config.minSize, config.maxSize);

        const opacity = isBrightStar
          ? 0.95 + this.seededRandom() * 0.05
          : config.minOpacity +
            this.seededRandom() * (config.maxOpacity - config.minOpacity);

        const shouldTwinkle = this.seededRandom() < 0.4;
        const twinkleDelay = this.randomFloat(0, 15);
        const twinkleDuration = this.randomFloat(2, 6);
        const twinkleAnimation = this.randomBetween(1, 20);

        stars.push({
          size,
          opacity,
          x,
          y,
          twinkleDelay,
          twinkleDuration,
          twinkleAnimation,
          shouldTwinkle,
        });
      }
    }

    return stars;
  }
}
