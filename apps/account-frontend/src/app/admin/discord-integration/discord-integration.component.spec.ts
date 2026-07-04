import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DiscordIntegrationComponent } from './discord-integration.component';

describe('DiscordIntegrationComponent', () => {
  let component: DiscordIntegrationComponent;
  let fixture: ComponentFixture<DiscordIntegrationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscordIntegrationComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DiscordIntegrationComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
