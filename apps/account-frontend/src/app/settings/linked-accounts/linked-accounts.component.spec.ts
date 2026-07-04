import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LinkedAccountsComponent } from './linked-accounts.component';

describe('LinkedAccountsComponent', () => {
  let component: LinkedAccountsComponent;
  let fixture: ComponentFixture<LinkedAccountsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LinkedAccountsComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LinkedAccountsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
