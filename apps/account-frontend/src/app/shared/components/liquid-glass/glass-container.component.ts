import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  PLATFORM_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  GlassFilterComponent,
  DisplacementMode,
} from './glass-filter.component';

export interface MouseOffset {
  x: number;
  y: number;
}

export interface GlassSize {
  width: number;
  height: number;
}

@Component({
  selector: 'app-glass-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlassFilterComponent],
  template: `
    <div
      #glassContainer
      [class]="
        'relative ' +
        className() +
        (active() ? ' active' : '') +
        (clickable() ? ' cursor-pointer' : '')
      "
      [style]="containerStyleValue()"
      (click)="handleClick()"
    >
      <app-glass-filter
        [mode]="mode()"
        [id]="filterId"
        [displacementScale]="displacementScale()"
        [aberrationIntensity]="aberrationIntensity()"
        [width]="glassSize().width"
        [height]="glassSize().height"
        [shaderMapUrl]="shaderMapUrl()"
      />

      <div
        class="glass"
        [style]="glassStyle()"
        (mouseenter)="handleMouseEnter()"
        (mouseleave)="handleMouseLeave()"
        (mousedown)="handleMouseDown()"
        (mouseup)="handleMouseUp()"
      >
        <!-- backdrop layer that gets wiggly -->
        <span class="glass__warp" [style]="backdropStyle()"></span>

        <!-- user content stays sharp -->
        <div
          class="transition-all duration-150 ease-in-out text-white"
          [style]="contentStyle()"
        >
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class GlassContainerComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);

  className = input('');
  containerStyleValue = input<Record<string, string | number>>({});
  displacementScale = input(25);
  blurAmount = input(12);
  saturation = input(180);
  aberrationIntensity = input(2);
  active = input(false);
  overLight = input(false);
  cornerRadius = input(999);
  padding = input('24px 32px');
  glassSize = input<GlassSize>({ width: 270, height: 69 });
  mode = input<DisplacementMode>('standard');
  shaderMapUrl = input<string | undefined>();
  mouseOffset = input<MouseOffset>({ x: 0, y: 0 });
  onClick = input<(() => void) | undefined>();
  onMouseEnter = input<(() => void) | undefined>();
  onMouseLeave = input<(() => void) | undefined>();
  onMouseDown = input<(() => void) | undefined>();
  onMouseUp = input<(() => void) | undefined>();

  filterId = `glass-filter-${Math.random().toString(36).substr(2, 9)}`;
  isFirefox = signal(false);
  clickable = computed(() => Boolean(this.onClick()));

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.isFirefox.set(navigator.userAgent.toLowerCase().includes('firefox'));
  }

  backdropStyle() {
    return {
      filter: this.isFirefox() ? null : `url(#${this.filterId})`,
      backdropFilter: `blur(${(this.overLight() ? 12 : 4) + this.blurAmount() * 32}px) saturate(${this.saturation()}%)`,
      position: 'absolute',
      inset: '0',
    };
  }

  glassStyle() {
    return {
      borderRadius: `${this.cornerRadius()}px`,
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '24px',
      padding: this.padding(),
      overflow: 'hidden',
      transition: 'all 0.2s ease-in-out',
      boxShadow: this.overLight()
        ? '0px 16px 70px rgba(0, 0, 0, 0.75)'
        : '0px 12px 40px rgba(0, 0, 0, 0.25)',
    };
  }

  contentStyle() {
    return {
      position: 'relative',
      zIndex: 1,
      font: '500 20px/1 system-ui',
      textShadow: this.overLight()
        ? '0px 2px 12px rgba(0, 0, 0, 0)'
        : '0px 2px 12px rgba(0, 0, 0, 0.4)',
    };
  }

  handleClick() {
    this.onClick()?.();
  }

  handleMouseEnter() {
    this.onMouseEnter()?.();
  }

  handleMouseLeave() {
    this.onMouseLeave()?.();
  }

  handleMouseDown() {
    this.onMouseDown()?.();
  }

  handleMouseUp() {
    this.onMouseUp()?.();
  }
}
