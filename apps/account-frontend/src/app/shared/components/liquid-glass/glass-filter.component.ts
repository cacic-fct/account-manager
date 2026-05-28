import { Component, Input, OnInit, signal } from '@angular/core';
import {
  displacementMap,
  polarDisplacementMap,
  prominentDisplacementMap,
} from './displacement-maps';
import { ShaderDisplacementGenerator, fragmentShaders } from './shader-utils';

export type DisplacementMode = 'standard' | 'polar' | 'prominent' | 'shader';

@Component({
  selector: 'app-glass-filter',
  template: `
    <svg
      [style.position]="'absolute'"
      [style.width.px]="width"
      [style.height.px]="height"
      aria-hidden="true"
    >
      <defs>
        <radialGradient [id]="id + '-edge-mask'" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="black" stop-opacity="0" />
          <stop
            [attr.offset]="Math.max(30, 80 - aberrationIntensity * 2) + '%'"
            stop-color="black"
            stop-opacity="0"
          />
          <stop offset="100%" stop-color="white" stop-opacity="1" />
        </radialGradient>

        <filter
          [id]="id"
          x="-35%"
          y="-35%"
          width="170%"
          height="170%"
          color-interpolation-filters="sRGB"
        >
          <feImage
            id="feimage"
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISPLACEMENT_MAP"
            [attr.href]="currentMap()"
            preserveAspectRatio="xMidYMid slice"
          />

          <!-- Create edge mask using the displacement map itself -->
          <feColorMatrix
            in="DISPLACEMENT_MAP"
            type="matrix"
            values="0.3 0.3 0.3 0 0
                   0.3 0.3 0.3 0 0
                   0.3 0.3 0.3 0 0
                   0 0 0 1 0"
            result="EDGE_INTENSITY"
          />
          <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
            <feFuncA
              type="discrete"
              [attr.tableValues]="'0 ' + aberrationIntensity * 0.05 + ' 1'"
            />
          </feComponentTransfer>

          <!-- Original undisplaced image for center -->
          <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />

          <!-- Red channel displacement with slight offset -->
          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            [attr.scale]="displacementScale * (mode === 'shader' ? 1 : -1)"
            xChannelSelector="R"
            yChannelSelector="B"
            result="RED_DISPLACED"
          />
          <feColorMatrix
            in="RED_DISPLACED"
            type="matrix"
            values="1 0 0 0 0
                   0 0 0 0 0
                   0 0 0 0 0
                   0 0 0 1 0"
            result="RED_CHANNEL"
          />

          <!-- Green channel displacement -->
          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            [attr.scale]="
              displacementScale *
              ((mode === 'shader' ? 1 : -1) - aberrationIntensity * 0.05)
            "
            xChannelSelector="R"
            yChannelSelector="B"
            result="GREEN_DISPLACED"
          />
          <feColorMatrix
            in="GREEN_DISPLACED"
            type="matrix"
            values="0 0 0 0 0
                   0 1 0 0 0
                   0 0 0 0 0
                   0 0 0 1 0"
            result="GREEN_CHANNEL"
          />

          <!-- Blue channel displacement with slight offset -->
          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            [attr.scale]="
              displacementScale *
              ((mode === 'shader' ? 1 : -1) - aberrationIntensity * 0.1)
            "
            xChannelSelector="R"
            yChannelSelector="B"
            result="BLUE_DISPLACED"
          />
          <feColorMatrix
            in="BLUE_DISPLACED"
            type="matrix"
            values="0 0 0 0 0
                   0 0 0 0 0
                   0 0 1 0 0
                   0 0 0 1 0"
            result="BLUE_CHANNEL"
          />

          <!-- Combine all channels with screen blend mode for chromatic aberration -->
          <feBlend
            in="GREEN_CHANNEL"
            in2="BLUE_CHANNEL"
            mode="screen"
            result="GB_COMBINED"
          />
          <feBlend
            in="RED_CHANNEL"
            in2="GB_COMBINED"
            mode="screen"
            result="RGB_COMBINED"
          />

          <!-- Add slight blur to soften the aberration effect -->
          <feGaussianBlur
            in="RGB_COMBINED"
            [attr.stdDeviation]="Math.max(0.1, 0.5 - aberrationIntensity * 0.1)"
            result="ABERRATED_BLURRED"
          />

          <!-- Apply edge mask to aberration effect -->
          <feComposite
            in="ABERRATED_BLURRED"
            in2="EDGE_MASK"
            operator="in"
            result="EDGE_ABERRATION"
          />

          <!-- Create inverted mask for center -->
          <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feComposite
            in="CENTER_ORIGINAL"
            in2="INVERTED_MASK"
            operator="in"
            result="CENTER_CLEAN"
          />

          <!-- Combine edge aberration with clean center -->
          <feComposite
            in="EDGE_ABERRATION"
            in2="CENTER_CLEAN"
            operator="over"
          />
        </filter>
      </defs>
    </svg>
  `,
})
export class GlassFilterComponent implements OnInit {
  @Input() id!: string;
  @Input() displacementScale!: number;
  @Input() aberrationIntensity!: number;
  @Input() width!: number;
  @Input() height!: number;
  @Input() mode!: DisplacementMode;
  @Input() shaderMapUrl?: string;

  Math = Math;
  currentMap = signal<string>('');

  ngOnInit() {
    this.currentMap.set(this.getMap());
  }

  private getMap(): string {
    switch (this.mode) {
      case 'standard':
        return displacementMap;
      case 'polar':
        return polarDisplacementMap;
      case 'prominent':
        return prominentDisplacementMap;
      case 'shader':
        return this.shaderMapUrl || displacementMap;
      default:
        throw new Error(`Invalid mode: ${this.mode}`);
    }
  }
}
