import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { signal } from '@angular/core';

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
});
