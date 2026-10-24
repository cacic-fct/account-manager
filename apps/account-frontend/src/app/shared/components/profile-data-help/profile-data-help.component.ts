import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-profile-data-help',
  imports: [MatIconModule],
  templateUrl: './profile-data-help.component.html',
  styleUrl: './profile-data-help.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileDataHelpComponent {
  section = input<'usage' | 'access' | 'all'>('all');
}
