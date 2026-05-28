import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DiscordIntegrationComponent } from './discord-integration.component';

describe('DiscordIntegrationComponent', () => {
  let component: DiscordIntegrationComponent;
  let fixture: ComponentFixture<DiscordIntegrationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscordIntegrationComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DiscordIntegrationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
