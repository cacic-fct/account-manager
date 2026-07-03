import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { KeycloakPermissionUser } from '@cacic/shared-types';

export type PermissionPersonSearchForm = FormGroup<{
  query: FormControl<string>;
}>;

@Component({
  selector: 'app-keycloak-permissions-person-picker',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <section class="person-picker" [attr.aria-label]="ariaLabel()">
      <div class="section-heading">
        <h3>Selecionar pessoa</h3>
        @if (selectedUser(); as user) {
          <span>{{ user.displayName }} selecionada</span>
        } @else {
          <span>{{ emptyHint() }}</span>
        }
      </div>

      <form class="search-form" [formGroup]="searchForm()" (ngSubmit)="search.emit()">
        <mat-form-field appearance="outline">
          <mat-label>Nome, CPF ou e-mail</mat-label>
          <input matInput type="search" formControlName="query" />
          <mat-icon matSuffix>search</mat-icon>
          @if (searchForm().controls.query.hasError("required")) {
            <mat-error>Informe nome, CPF ou e-mail.</mat-error>
          } @else if (searchForm().controls.query.hasError("minlength")) {
            <mat-error>Digite pelo menos 2 caracteres.</mat-error>
          }
        </mat-form-field>
        <button
          mat-flat-button
          color="primary"
          type="submit"
          [disabled]="searching()"
        >
          @if (searching()) {
            <mat-spinner diameter="20"></mat-spinner>
          } @else {
            <mat-icon>search</mat-icon>
          }
          @if (searching()) {
            Buscando
          } @else {
            Buscar pessoa
          }
        </button>
      </form>

      @if (users().length > 0) {
        <div class="user-results">
          @for (user of users(); track user.id) {
            <button
              type="button"
              class="user-result"
              [class.selected]="selectedUser()?.id === user.id"
              [attr.aria-pressed]="selectedUser()?.id === user.id"
              (click)="userSelected.emit(user)"
            >
              <span class="user-main">
                <mat-icon>person</mat-icon>
                <span>
                  <strong>{{ user.displayName }}</strong>
                  <small>{{ user.email }}</small>
                </span>
              </span>
              @if (user.identityDocument) {
                <span class="identity">{{ user.identityDocument }}</span>
              }
            </button>
          }
        </div>
      } @else if (!searching() && searchForm().controls.query.touched) {
        <div class="empty-state compact">
          <mat-icon>person_search</mat-icon>
          <p>Nenhuma pessoa encontrada. Revise os dados e tente novamente.</p>
        </div>
      }
    </section>
  `,
  styleUrl: './keycloak-permissions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeycloakPermissionsPersonPickerComponent {
  ariaLabel = input.required<string>();
  emptyHint = input.required<string>();
  searchForm = input.required<PermissionPersonSearchForm>();
  searching = input.required<boolean>();
  selectedUser = input.required<KeycloakPermissionUser | null>();
  users = input.required<KeycloakPermissionUser[]>();

  search = output<void>();
  userSelected = output<KeycloakPermissionUser>();
}
