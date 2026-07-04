import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { StarConfig } from './star-pattern-generator';

@Component({
  selector: 'app-star',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="star"
      [style.top.%]="star().y"
      [style.left.%]="star().x"
      [style.width.px]="star().size"
      [style.height.px]="star().size"
      [style.background-color]="starColor()"
      [style.animation]="starAnimation()"></div>
  `,
  styles: [
    `
      .star {
        position: absolute;
        border-radius: 50%;
        pointer-events: none;
      }
    `,
  ],
})
export class StarComponent {
  // Input: star configuration
  readonly star = input.required<StarConfig>();

  // Computed star color
  readonly starColor = computed(() => {
    const starConfig = this.star();
    return starConfig.opacity === 1 ? '#fff' : `rgba(255, 255, 255, ${starConfig.opacity})`;
  });

  // Computed animation
  readonly starAnimation = computed(() => {
    const starConfig = this.star();
    if (starConfig.shouldTwinkle) {
      return `twinkle${starConfig.twinkleAnimation} ${starConfig.twinkleDuration}s ease-in-out infinite ${starConfig.twinkleDelay}s`;
    }
    return 'none';
  });
}
