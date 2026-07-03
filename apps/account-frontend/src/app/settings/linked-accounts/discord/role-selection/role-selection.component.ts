import { Component } from '@angular/core';
import { DiscordRoleSelectionComponent } from './components/discord-role-selection.component';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-role-selection',
  imports: [
    DiscordRoleSelectionComponent,
    MatToolbarModule,
    MatIconModule,
    RouterLink,
    MatButtonModule,
  ],
  templateUrl: './role-selection.component.html',
  styleUrl: './role-selection.component.scss',
})
export class RoleSelectionComponent {}
