import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
  KeycloakPermissionUser,
  PermissionGroupDefinition,
  PermissionGroupKey,
  PermissionGroupMembership,
  PermissionGroupMembershipCreateRequest,
  PermissionGroupMembershipUpdateRequest,
  PermissionGroupRoleGrant,
  PermissionGroupRoleGrantUpdateRequest,
  PermissionSelfRemovalResult,
  PermissionSelfServiceAccess,
} from '@cacic/shared-types';
import { getApiBaseUrl } from '../../utils/api-url.util';

@Injectable({
  providedIn: 'root',
})
export class KeycloakPermissionsApiService {
  private readonly baseUrl = getApiBaseUrl();
  private http = inject(HttpClient);

  getKeycloakPermissionCatalog(): Observable<KeycloakPermissionDefinition[]> {
    return this.http.get<KeycloakPermissionDefinition[]>(
      `${this.baseUrl}/admin/permissions/catalog`,
      {
        withCredentials: true,
      },
    );
  }

  getPermissionGroupCatalog(): Observable<PermissionGroupDefinition[]> {
    return this.http.get<PermissionGroupDefinition[]>(
      `${this.baseUrl}/admin/permissions/groups/catalog`,
      {
        withCredentials: true,
      },
    );
  }

  getPermissionGroupRoleGrants(
    groupKey: PermissionGroupKey,
  ): Observable<PermissionGroupRoleGrant[]> {
    const encodedGroupKey = encodeURIComponent(groupKey);

    return this.http.get<PermissionGroupRoleGrant[]>(
      `${this.baseUrl}/admin/permissions/groups/${encodedGroupKey}/role-grants`,
      {
        withCredentials: true,
      },
    );
  }

  updatePermissionGroupRoleGrants(
    groupKey: PermissionGroupKey,
    dto: PermissionGroupRoleGrantUpdateRequest,
  ): Observable<PermissionGroupRoleGrant[]> {
    const encodedGroupKey = encodeURIComponent(groupKey);

    return this.http.put<PermissionGroupRoleGrant[]>(
      `${this.baseUrl}/admin/permissions/groups/${encodedGroupKey}/role-grants`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  searchKeycloakPermissionUsers(
    query: string,
  ): Observable<KeycloakPermissionUser[]> {
    return this.http.get<KeycloakPermissionUser[]>(
      `${this.baseUrl}/admin/permissions/users`,
      {
        params: { query },
        withCredentials: true,
      },
    );
  }

  getKeycloakPermissionGrants(
    userId: string,
  ): Observable<KeycloakPermissionGrant[]> {
    return this.http.get<KeycloakPermissionGrant[]>(
      `${this.baseUrl}/admin/permissions/users/${userId}/grants`,
      {
        withCredentials: true,
      },
    );
  }

  getUserPermissionGroupMemberships(
    userId: string,
  ): Observable<PermissionGroupMembership[]> {
    return this.http.get<PermissionGroupMembership[]>(
      `${this.baseUrl}/admin/permissions/users/${userId}/group-memberships`,
      {
        withCredentials: true,
      },
    );
  }

  getPermissionGroupMemberships(
    groupKey?: PermissionGroupKey,
  ): Observable<PermissionGroupMembership[]> {
    return this.http.get<PermissionGroupMembership[]>(
      `${this.baseUrl}/admin/permissions/groups/memberships`,
      {
        ...(groupKey ? { params: { groupKey } } : {}),
        withCredentials: true,
      },
    );
  }

  createKeycloakPermissionGrant(
    dto: KeycloakPermissionGrantCreateRequest,
  ): Observable<KeycloakPermissionGrant> {
    return this.http.post<KeycloakPermissionGrant>(
      `${this.baseUrl}/admin/permissions/grants`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  createPermissionGroupMembership(
    dto: PermissionGroupMembershipCreateRequest,
  ): Observable<PermissionGroupMembership> {
    return this.http.post<PermissionGroupMembership>(
      `${this.baseUrl}/admin/permissions/groups/memberships`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  updateKeycloakPermissionGrant(
    id: string,
    dto: KeycloakPermissionGrantUpdateRequest,
  ): Observable<KeycloakPermissionGrant> {
    return this.http.put<KeycloakPermissionGrant>(
      `${this.baseUrl}/admin/permissions/grants/${id}`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  updatePermissionGroupMembership(
    id: string,
    dto: PermissionGroupMembershipUpdateRequest,
  ): Observable<PermissionGroupMembership> {
    return this.http.put<PermissionGroupMembership>(
      `${this.baseUrl}/admin/permissions/groups/memberships/${id}`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  deleteKeycloakPermissionGrant(
    id: string,
  ): Observable<{ deleted: true; id: string }> {
    return this.http.delete<{ deleted: true; id: string }>(
      `${this.baseUrl}/admin/permissions/grants/${id}`,
      {
        withCredentials: true,
      },
    );
  }

  deletePermissionGroupMembership(
    id: string,
  ): Observable<{ deleted: true; id: string }> {
    return this.http.delete<{ deleted: true; id: string }>(
      `${this.baseUrl}/admin/permissions/groups/memberships/${id}`,
      {
        withCredentials: true,
      },
    );
  }

  syncKeycloakPermissionGrants(): Observable<{ queued: true }> {
    return this.http.post<{ queued: true }>(
      `${this.baseUrl}/admin/permissions/sync`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  getSelfServiceAccess(): Observable<PermissionSelfServiceAccess> {
    return this.http.get<PermissionSelfServiceAccess>(
      `${this.baseUrl}/permissions/me`,
      {
        withCredentials: true,
      },
    );
  }

  selfRemoveMembership(
    id: string,
  ): Observable<PermissionSelfRemovalResult> {
    return this.http.delete<PermissionSelfRemovalResult>(
      `${this.baseUrl}/permissions/me/groups/${id}`,
      {
        withCredentials: true,
      },
    );
  }

  selfRemoveGrant(id: string): Observable<PermissionSelfRemovalResult> {
    return this.http.delete<PermissionSelfRemovalResult>(
      `${this.baseUrl}/permissions/me/grants/${id}`,
      {
        withCredentials: true,
      },
    );
  }
}
