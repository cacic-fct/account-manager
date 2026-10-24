import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { AuthService } from '../../../shared/services/auth/auth.service';
import { EditProfileComponent } from './edit.component';

describe('EditProfileComponent', () => {
  let component: EditProfileComponent;
  let fixture: ComponentFixture<EditProfileComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditProfileComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: signal(null),
          },
        },
        {
          provide: Router,
          useValue: {
            navigateByUrl: () => Promise.resolve(true),
          },
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: () => undefined,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EditProfileComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it.each([
    [
      'Invalid phone number format. Please use a valid international phone number.',
      'Confira o telefone e o código do país antes de salvar novamente.',
    ],
    [
      'Unknown validation error with private details',
      'Alguns dados não foram aceitos. Confira os campos do formulário e tente salvar novamente.',
    ],
  ])('shows Portuguese profile guidance for backend validation: %s', (message, expectedMessage) => {
    const snackBar = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

    component.onProfileSaveError(new HttpErrorResponse({ status: 400, error: { message } }));

    expect(snackBar).toHaveBeenCalledWith(expectedMessage, 'Fechar', expect.any(Object));
  });
});
