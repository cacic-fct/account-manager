import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../shared/services/api.service';
import {
  mockDirectKeycloakPermissionGrant,
  mockStudentEntityMemberships,
} from '../../../storybook/mocks/component-mocks';
import { PermissionsSelfServiceComponent } from './permissions-self-service.component';

type PermissionsSelfServiceHarness = PermissionsSelfServiceComponent & {
  confirmRemoveGrant: (grant: typeof mockDirectKeycloakPermissionGrant) => void;
};

describe('PermissionsSelfServiceComponent', () => {
  let fixture: ComponentFixture<PermissionsSelfServiceComponent>;
  let apiService: {
    getSelfServicePermissions: ReturnType<typeof vi.fn>;
    selfRemovePermissionGroupMembership: ReturnType<typeof vi.fn>;
    selfRemovePermissionGrant: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    apiService = {
      getSelfServicePermissions: vi.fn().mockReturnValue(
        of({
          memberships: [mockStudentEntityMemberships[0]],
          grants: [mockDirectKeycloakPermissionGrant],
        }),
      ),
      selfRemovePermissionGroupMembership: vi
        .fn()
        .mockReturnValue(of({ removed: true, id: 'membership-1' })),
      selfRemovePermissionGrant: vi
        .fn()
        .mockReturnValue(of({ removed: true, id: 'grant-1' })),
    };

    await TestBed.configureTestingModule({
      imports: [PermissionsSelfServiceComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ApiService,
          useValue: apiService,
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(() => ({ afterClosed: () => of(true) })),
          },
        },
        {
          provide: MatSnackBar,
          useValue: { open: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PermissionsSelfServiceComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads current user memberships and direct grants', () => {
    expect(apiService.getSelfServicePermissions).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Grupos');
    expect(fixture.nativeElement.textContent).toContain('CACiC');
    expect(fixture.nativeElement.textContent).toContain('Permissões diretas');
  });

  it('confirms and removes a direct grant', () => {
    const component =
      fixture.componentInstance as PermissionsSelfServiceHarness;

    component.confirmRemoveGrant(mockDirectKeycloakPermissionGrant);

    expect(apiService.selfRemovePermissionGrant).toHaveBeenCalledWith(
      mockDirectKeycloakPermissionGrant.id,
    );
  });
});
