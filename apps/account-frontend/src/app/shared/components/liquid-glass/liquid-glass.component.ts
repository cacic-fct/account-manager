import {
  Component,
  OnInit,
  ElementRef,
  ViewChild,
  ChangeDetectionStrategy,
  signal,
  computed,
  effect,
  inject,
  DestroyRef,
  input,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import {
  GlassContainerComponent,
  MouseOffset,
  GlassSize,
} from './glass-container.component';
import { DisplacementMode } from './glass-filter.component';
import { ShaderDisplacementGenerator, fragmentShaders } from './shader-utils';

export interface LiquidGlassProps {
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  cornerRadius?: number;
  globalMousePos?: { x: number; y: number };
  mouseOffset?: MouseOffset;
  mouseContainer?: ElementRef<HTMLElement> | null;
  className?: string;
  padding?: string;
  style?: Record<string, string | number>;
  overLight?: boolean;
  mode?: DisplacementMode;
  onClick?: () => void;
}

@Component({
  selector: 'app-liquid-glass',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlassContainerComponent],
  template: `
    <!-- Over light effect -->
    <div
      [class]="
        'bg-black transition-all duration-150 ease-in-out pointer-events-none ' +
        (overLight() ? 'opacity-20' : 'opacity-0')
      "
      [style]="overLightStyle1()"
    ></div>

    <div
      [class]="
        'bg-black transition-all duration-150 ease-in-out pointer-events-none mix-blend-overlay ' +
        (overLight() ? 'opacity-100' : 'opacity-0')
      "
      [style]="overLightStyle2()"
    ></div>

    <app-glass-container
      #glassRef
      [className]="className()"
      [containerStyleValue]="baseStyle()"
      [cornerRadius]="cornerRadius()"
      [displacementScale]="
        overLight() ? displacementScale() * 0.5 : displacementScale()
      "
      [blurAmount]="blurAmount()"
      [saturation]="saturation()"
      [aberrationIntensity]="aberrationIntensity()"
      [glassSize]="glassSize()"
      [padding]="padding()"
      [mouseOffset]="internalMouseOffset()"
      [onMouseEnter]="handleMouseEnter"
      [onMouseLeave]="handleMouseLeave"
      [onMouseDown]="handleMouseDown"
      [onMouseUp]="handleMouseUp"
      [active]="isActive()"
      [overLight]="overLight()"
      [onClick]="onClick()"
      [mode]="mode()"
      [shaderMapUrl]="shaderMapUrl()"
    >
      <ng-content></ng-content>
    </app-glass-container>

    <!-- Border layer 1 -->
    <span [style]="borderLayer1Style()"></span>

    <!-- Border layer 2 -->
    <span [style]="borderLayer2Style()"></span>

    <!-- Hover effects -->
    @if (onClick()) {
      <div [style]="hoverEffect1Style()"></div>
      <div [style]="hoverEffect2Style()"></div>
      <div [style]="hoverEffect3Style()"></div>
    }
  `,
})
export class LiquidGlassComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  @ViewChild('glassRef', { static: true, read: ElementRef })
  glassRef!: ElementRef<HTMLDivElement>;

  displacementScale = input(70);
  blurAmount = input(0.0625);
  saturation = input(140);
  aberrationIntensity = input(2);
  elasticity = input(0.15);
  cornerRadius = input(999);
  globalMousePos = input<{ x: number; y: number } | undefined>();
  mouseOffset = input<MouseOffset | undefined>();
  mouseContainer = input<ElementRef<HTMLElement> | null | undefined>();
  className = input('');
  padding = input('24px 32px');
  overLight = input(false);
  style = input<Record<string, string | number>>({});
  mode = input<DisplacementMode>('standard');
  onClick = input<(() => void) | undefined>();

  // Internal state
  isHovered = signal(false);
  isActive = signal(false);
  glassSize = signal<GlassSize>({ width: 270, height: 69 });
  internalGlobalMousePos = signal({ x: 0, y: 0 });
  internalMouseOffset = signal<MouseOffset>({ x: 0, y: 0 });
  shaderMapUrl = signal<string>('');

  // Computed values
  computedGlobalMousePos = computed(
    () => this.globalMousePos() || this.internalGlobalMousePos(),
  );
  computedMouseOffset = computed(
    () => this.mouseOffset() || this.internalMouseOffset(),
  );

  constructor() {
    // Generate shader displacement map when in shader mode
    effect(() => {
      if (this.isBrowser && this.mode() === 'shader') {
        const url = this.generateShaderDisplacementMap(
          this.glassSize().width,
          this.glassSize().height,
        );
        this.shaderMapUrl.set(url);
      }
    });
  }

  ngOnInit() {
    this.setupMouseTracking();
    this.updateGlassSize();
    this.setupResizeListener();
  }

  private generateShaderDisplacementMap(width: number, height: number): string {
    if (!this.isBrowser) {
      return '';
    }

    const generator = new ShaderDisplacementGenerator({
      width,
      height,
      fragment: fragmentShaders.liquidGlass,
    });

    const dataUrl = generator.updateShader();
    generator.destroy();

    return dataUrl;
  }

  private setupMouseTracking() {
    if (!this.isBrowser) {
      return;
    }

    if (this.globalMousePos() && this.mouseOffset()) {
      // External mouse tracking is provided, don't set up internal tracking
      return;
    }

    const container =
      this.mouseContainer()?.nativeElement || this.glassRef?.nativeElement;
    if (!container) {
      return;
    }

    fromEvent<MouseEvent>(container, 'mousemove')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => this.handleMouseMove(e));
  }

  private handleMouseMove(e: MouseEvent) {
    const container =
      this.mouseContainer()?.nativeElement || this.glassRef?.nativeElement;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    this.internalMouseOffset.set({
      x: ((e.clientX - centerX) / rect.width) * 100,
      y: ((e.clientY - centerY) / rect.height) * 100,
    });

    this.internalGlobalMousePos.set({
      x: e.clientX,
      y: e.clientY,
    });
  }

  private setupResizeListener() {
    if (!this.isBrowser) {
      return;
    }

    fromEvent(window, 'resize')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateGlassSize());
  }

  private updateGlassSize() {
    if (!this.isBrowser) {
      return;
    }

    if (this.glassRef?.nativeElement) {
      const rect = this.glassRef.nativeElement.getBoundingClientRect();
      this.glassSize.set({ width: rect.width, height: rect.height });
    }
  }

  // Calculate directional scaling based on mouse position
  private calculateDirectionalScale(): string {
    const globalMousePos = this.computedGlobalMousePos();
    if (
      !globalMousePos.x ||
      !globalMousePos.y ||
      !this.glassRef?.nativeElement
    ) {
      return 'scale(1)';
    }

    const rect = this.glassRef.nativeElement.getBoundingClientRect();
    const pillCenterX = rect.left + rect.width / 2;
    const pillCenterY = rect.top + rect.height / 2;
    const pillWidth = this.glassSize().width;
    const pillHeight = this.glassSize().height;

    const deltaX = globalMousePos.x - pillCenterX;
    const deltaY = globalMousePos.y - pillCenterY;

    // Calculate distance from mouse to pill edges (not center)
    const edgeDistanceX = Math.max(0, Math.abs(deltaX) - pillWidth / 2);
    const edgeDistanceY = Math.max(0, Math.abs(deltaY) - pillHeight / 2);
    const edgeDistance = Math.sqrt(
      edgeDistanceX * edgeDistanceX + edgeDistanceY * edgeDistanceY,
    );

    // Activation zone: 200px from edges
    const activationZone = 200;

    // If outside activation zone, no effect
    if (edgeDistance > activationZone) {
      return 'scale(1)';
    }

    // Calculate fade-in factor (1 at edge, 0 at activation zone boundary)
    const fadeInFactor = 1 - edgeDistance / activationZone;

    // Normalize the deltas for direction
    const centerDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (centerDistance === 0) {
      return 'scale(1)';
    }

    const normalizedX = deltaX / centerDistance;
    const normalizedY = deltaY / centerDistance;

    // Calculate stretch factors with fade-in
    const stretchIntensity =
      Math.min(centerDistance / 300, 1) * this.elasticity() * fadeInFactor;

    // X-axis scaling: stretch horizontally when moving left/right, compress when moving up/down
    const scaleX =
      1 +
      Math.abs(normalizedX) * stretchIntensity * 0.3 -
      Math.abs(normalizedY) * stretchIntensity * 0.15;

    // Y-axis scaling: stretch vertically when moving up/down, compress when moving left/right
    const scaleY =
      1 +
      Math.abs(normalizedY) * stretchIntensity * 0.3 -
      Math.abs(normalizedX) * stretchIntensity * 0.15;

    return `scaleX(${Math.max(0.8, scaleX)}) scaleY(${Math.max(0.8, scaleY)})`;
  }

  private calculateFadeInFactor(): number {
    const globalMousePos = this.computedGlobalMousePos();
    if (
      !globalMousePos.x ||
      !globalMousePos.y ||
      !this.glassRef?.nativeElement
    ) {
      return 0;
    }

    const rect = this.glassRef.nativeElement.getBoundingClientRect();
    const pillCenterX = rect.left + rect.width / 2;
    const pillCenterY = rect.top + rect.height / 2;
    const pillWidth = this.glassSize().width;
    const pillHeight = this.glassSize().height;

    const edgeDistanceX = Math.max(
      0,
      Math.abs(globalMousePos.x - pillCenterX) - pillWidth / 2,
    );
    const edgeDistanceY = Math.max(
      0,
      Math.abs(globalMousePos.y - pillCenterY) - pillHeight / 2,
    );
    const edgeDistance = Math.sqrt(
      edgeDistanceX * edgeDistanceX + edgeDistanceY * edgeDistanceY,
    );

    const activationZone = 200;
    return edgeDistance > activationZone
      ? 0
      : 1 - edgeDistance / activationZone;
  }

  private calculateElasticTranslation(): { x: number; y: number } {
    if (!this.glassRef?.nativeElement) {
      return { x: 0, y: 0 };
    }

    const fadeInFactor = this.calculateFadeInFactor();
    const rect = this.glassRef.nativeElement.getBoundingClientRect();
    const pillCenterX = rect.left + rect.width / 2;
    const pillCenterY = rect.top + rect.height / 2;
    const globalMousePos = this.computedGlobalMousePos();

    return {
      x:
        (globalMousePos.x - pillCenterX) *
        this.elasticity() *
        0.1 *
        fadeInFactor,
      y:
        (globalMousePos.y - pillCenterY) *
        this.elasticity() *
        0.1 *
        fadeInFactor,
    };
  }

  // Style getters
  transformStyle(): string {
    const translation = this.calculateElasticTranslation();
    const scale =
      this.isActive() && Boolean(this.onClick())
        ? 'scale(0.96)'
        : this.calculateDirectionalScale();
    return `translate(calc(-50% + ${translation.x}px), calc(-50% + ${translation.y}px)) ${scale}`;
  }

  baseStyle() {
    const style = this.style();
    return {
      ...style,
      transform: this.transformStyle(),
      transition: 'all ease-out 0.2s',
      position: style['position'] || 'relative',
      top: style['top'] || '50%',
      left: style['left'] || '50%',
    };
  }

  overLightStyle1() {
    const baseStyle = this.baseStyle();
    return {
      position: baseStyle.position,
      top: baseStyle.top,
      left: baseStyle.left,
      height: this.glassSize().height + 'px',
      width: this.glassSize().width + 'px',
      borderRadius: `${this.cornerRadius()}px`,
      transform: baseStyle.transform,
      transition: baseStyle.transition,
    };
  }

  overLightStyle2() {
    return this.overLightStyle1();
  }

  borderLayer1Style() {
    const baseStyle = this.baseStyle();
    const mouseOffset = this.computedMouseOffset();
    return {
      position: baseStyle.position,
      top: baseStyle.top,
      left: baseStyle.left,
      height: this.glassSize().height + 'px',
      width: this.glassSize().width + 'px',
      borderRadius: `${this.cornerRadius()}px`,
      transform: baseStyle.transform,
      transition: baseStyle.transition,
      pointerEvents: 'none',
      mixBlendMode: 'screen',
      opacity: 0.2,
      padding: '1.5px',
      WebkitMask:
        'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
      WebkitMaskComposite: 'xor',
      maskComposite: 'exclude',
      boxShadow:
        '0 0 0 0.5px rgba(255, 255, 255, 0.5) inset, 0 1px 3px rgba(255, 255, 255, 0.25) inset, 0 1px 4px rgba(0, 0, 0, 0.35)',
      background: `linear-gradient(
        ${135 + mouseOffset.x * 1.2}deg,
        rgba(255, 255, 255, 0.0) 0%,
        rgba(255, 255, 255, ${0.12 + Math.abs(mouseOffset.x) * 0.008}) ${Math.max(10, 33 + mouseOffset.y * 0.3)}%,
        rgba(255, 255, 255, ${0.4 + Math.abs(mouseOffset.x) * 0.012}) ${Math.min(90, 66 + mouseOffset.y * 0.4)}%,
        rgba(255, 255, 255, 0.0) 100%
      )`,
    };
  }

  borderLayer2Style() {
    const baseStyle = this.baseStyle();
    const mouseOffset = this.computedMouseOffset();
    return {
      position: baseStyle.position,
      top: baseStyle.top,
      left: baseStyle.left,
      height: this.glassSize().height + 'px',
      width: this.glassSize().width + 'px',
      borderRadius: `${this.cornerRadius()}px`,
      transform: baseStyle.transform,
      transition: baseStyle.transition,
      pointerEvents: 'none',
      mixBlendMode: 'overlay',
      padding: '1.5px',
      WebkitMask:
        'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
      WebkitMaskComposite: 'xor',
      maskComposite: 'exclude',
      boxShadow:
        '0 0 0 0.5px rgba(255, 255, 255, 0.5) inset, 0 1px 3px rgba(255, 255, 255, 0.25) inset, 0 1px 4px rgba(0, 0, 0, 0.35)',
      background: `linear-gradient(
        ${135 + mouseOffset.x * 1.2}deg,
        rgba(255, 255, 255, 0.0) 0%,
        rgba(255, 255, 255, ${0.32 + Math.abs(mouseOffset.x) * 0.008}) ${Math.max(10, 33 + mouseOffset.y * 0.3)}%,
        rgba(255, 255, 255, ${0.6 + Math.abs(mouseOffset.x) * 0.012}) ${Math.min(90, 66 + mouseOffset.y * 0.4)}%,
        rgba(255, 255, 255, 0.0) 100%
      )`,
    };
  }

  hoverEffect1Style() {
    const baseStyle = this.baseStyle();
    return {
      position: baseStyle.position,
      top: baseStyle.top,
      left: baseStyle.left,
      height: this.glassSize().height + 'px',
      width: this.glassSize().width + 1 + 'px',
      borderRadius: `${this.cornerRadius()}px`,
      transform: baseStyle.transform,
      pointerEvents: 'none',
      transition: 'all 0.2s ease-out',
      opacity: this.isHovered() || this.isActive() ? 0.5 : 0,
      backgroundImage:
        'radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%)',
      mixBlendMode: 'overlay',
    };
  }

  hoverEffect2Style() {
    const baseStyle = this.baseStyle();
    return {
      position: baseStyle.position,
      top: baseStyle.top,
      left: baseStyle.left,
      height: this.glassSize().height + 'px',
      width: this.glassSize().width + 1 + 'px',
      borderRadius: `${this.cornerRadius()}px`,
      transform: baseStyle.transform,
      pointerEvents: 'none',
      transition: 'all 0.2s ease-out',
      opacity: this.isActive() ? 0.5 : 0,
      backgroundImage:
        'radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 80%)',
      mixBlendMode: 'overlay',
    };
  }

  hoverEffect3Style() {
    const baseStyle = this.baseStyle();
    return {
      ...baseStyle,
      height: this.glassSize().height + 'px',
      width: this.glassSize().width + 1 + 'px',
      borderRadius: `${this.cornerRadius()}px`,
      pointerEvents: 'none',
      transition: 'all 0.2s ease-out',
      opacity: this.isHovered() ? 0.4 : this.isActive() ? 0.8 : 0,
      backgroundImage:
        'radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 100%)',
      mixBlendMode: 'overlay',
    };
  }

  // Event handlers
  handleMouseEnter = () => {
    this.isHovered.set(true);
  };

  handleMouseLeave = () => {
    this.isHovered.set(false);
  };

  handleMouseDown = () => {
    this.isActive.set(true);
  };

  handleMouseUp = () => {
    this.isActive.set(false);
  };
}
