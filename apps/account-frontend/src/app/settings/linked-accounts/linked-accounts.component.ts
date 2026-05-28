import { Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { DiscordIntegrationComponent } from './components/discord-integration.component';
import { StudentVerificationCardComponent } from './components/student-verification-card.component';
import { GoogleAccountLinkingComponent } from './components/google-account-linking.component';

@Component({
  selector: 'app-linked-accounts',
  imports: [
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    RouterLink,
    GoogleAccountLinkingComponent,
    DiscordIntegrationComponent,
    StudentVerificationCardComponent,
  ],
  templateUrl: './linked-accounts.component.html',
  styleUrl: './linked-accounts.component.scss',
})
export class LinkedAccountsComponent {}
