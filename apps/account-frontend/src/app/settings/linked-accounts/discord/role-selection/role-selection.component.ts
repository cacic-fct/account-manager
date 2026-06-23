import { Component, ChangeDetectionStrategy } from '@angular/core';
import { DiscordRoleSelectionComponent } from './components/discord-role-selection.component';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-role-selection',
  imports: [DiscordRoleSelectionComponent, MatToolbarModule, MatIconModule],
  templateUrl: './role-selection.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './role-selection.component.scss',
})
export class RoleSelectionComponent {}
