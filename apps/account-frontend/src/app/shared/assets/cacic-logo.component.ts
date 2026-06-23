import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-cacic-logo',
  templateUrl: './cacic-logo.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./cacic-logo.component.scss'],
})
export class CacicLogoComponent {
  fillColor = input<string>('#000');
  width = input<string>('100%');
  height = input<string>('100%');
}
