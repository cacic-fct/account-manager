import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-cacic-logo',
  templateUrl: './cacic-logo.component.html',
  styleUrls: ['./cacic-logo.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CacicLogoComponent {
  fillColor = input<string>('#000');
  width = input<string>('100%');
  height = input<string>('100%');
}
