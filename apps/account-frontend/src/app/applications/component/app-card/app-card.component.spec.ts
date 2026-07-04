import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppCardComponent } from './app-card.component';

describe('AppCardComponent', () => {
  let component: AppCardComponent;
  let fixture: ComponentFixture<AppCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AppCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('app', {
      id: 'test-app',
      name: 'Test app',
      enabled: true,
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
