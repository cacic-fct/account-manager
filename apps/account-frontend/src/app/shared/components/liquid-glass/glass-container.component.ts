import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  signal,
  effect,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
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
        className +
        (active() ? ' active' : '') +
        (clickable() ? ' cursor-pointer' : '')
      "
      [style]="containerStyleValue"
      (click)="handleClick()"
    >
      <app-glass-filter
        [mode]="mode"
        [id]="filterId"
        [displacementScale]="displacementScale"
        [aberrationIntensity]="aberrationIntensity"
        [width]="glassSize().width"
        [height]="glassSize().height"
        [shaderMapUrl]="shaderMapUrl"
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
export class GlassContainerComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);

  @Input() className = '';
  @Input() containerStyleValue: Record<string, string | number> = {};
  @Input() displacementScale = 25;
  @Input() blurAmount = 12;
  @Input() saturation = 180;
  @Input() aberrationIntensity = 2;
  @Input() active = signal(false);
  @Input() overLight = false;
  @Input() cornerRadius = 999;
  @Input() padding = '24px 32px';
  @Input() glassSize = signal<GlassSize>({ width: 270, height: 69 });
  @Input() mode: DisplacementMode = 'standard';
  @Input() shaderMapUrl?: string;
  @Input() mouseOffset = signal<MouseOffset>({ x: 0, y: 0 });
  @Input() onClick?: () => void;
  @Input() onMouseEnter?: () => void;
  @Input() onMouseLeave?: () => void;
  @Input() onMouseDown?: () => void;
  @Input() onMouseUp?: () => void;

  filterId = `glass-filter-${Math.random().toString(36).substr(2, 9)}`;
  isFirefox = signal(false);
  clickable = signal(false);

  constructor() {
    effect(() => {
      this.clickable.set(Boolean(this.onClick));
    });
  }

  ngOnInit() {
    this.isFirefox.set(navigator.userAgent.toLowerCase().includes('firefox'));
  }

  ngOnDestroy() {
    // Cleanup handled by DestroyRef
  }

  backdropStyle() {
    return {
      filter: this.isFirefox() ? null : `url(#${this.filterId})`,
      backdropFilter: `blur(${(this.overLight ? 12 : 4) + this.blurAmount * 32}px) saturate(${this.saturation}%)`,
      position: 'absolute',
      inset: '0',
    };
  }

  glassStyle() {
    return {
      borderRadius: `${this.cornerRadius}px`,
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '24px',
      padding: this.padding,
      overflow: 'hidden',
      transition: 'all 0.2s ease-in-out',
      boxShadow: this.overLight
        ? '0px 16px 70px rgba(0, 0, 0, 0.75)'
        : '0px 12px 40px rgba(0, 0, 0, 0.25)',
    };
  }

  contentStyle() {
    return {
      position: 'relative',
      zIndex: 1,
      font: '500 20px/1 system-ui',
      textShadow: this.overLight
        ? '0px 2px 12px rgba(0, 0, 0, 0)'
        : '0px 2px 12px rgba(0, 0, 0, 0.4)',
    };
  }

  handleClick() {
    this.onClick?.();
  }

  handleMouseEnter() {
    this.onMouseEnter?.();
  }

  handleMouseLeave() {
    this.onMouseLeave?.();
  }

  handleMouseDown() {
    this.onMouseDown?.();
  }

  handleMouseUp() {
    this.onMouseUp?.();
  }
}
