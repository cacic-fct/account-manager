import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
  KeycloakPermissionUser,
  StudentEntityDefinition,
  StudentEntityKey,
  StudentEntityMembership,
  StudentEntityMembershipCreateRequest,
  StudentEntityMembershipUpdateRequest,
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

  getStudentEntityCatalog(): Observable<StudentEntityDefinition[]> {
    return this.http.get<StudentEntityDefinition[]>(
      `${this.baseUrl}/admin/permissions/student-entities/catalog`,
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

  getUserStudentEntityMemberships(
    userId: string,
  ): Observable<StudentEntityMembership[]> {
    return this.http.get<StudentEntityMembership[]>(
      `${this.baseUrl}/admin/permissions/users/${userId}/student-entity-memberships`,
      {
        withCredentials: true,
      },
    );
  }

  getStudentEntityMemberships(
    entity?: StudentEntityKey,
  ): Observable<StudentEntityMembership[]> {
    return this.http.get<StudentEntityMembership[]>(
      `${this.baseUrl}/admin/permissions/student-entities/memberships`,
      {
        ...(entity ? { params: { entity } } : {}),
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

  createStudentEntityMembership(
    dto: StudentEntityMembershipCreateRequest,
  ): Observable<StudentEntityMembership> {
    return this.http.post<StudentEntityMembership>(
      `${this.baseUrl}/admin/permissions/student-entities/memberships`,
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

  updateStudentEntityMembership(
    id: string,
    dto: StudentEntityMembershipUpdateRequest,
  ): Observable<StudentEntityMembership> {
    return this.http.put<StudentEntityMembership>(
      `${this.baseUrl}/admin/permissions/student-entities/memberships/${id}`,
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

  deleteStudentEntityMembership(
    id: string,
  ): Observable<{ deleted: true; id: string }> {
    return this.http.delete<{ deleted: true; id: string }>(
      `${this.baseUrl}/admin/permissions/student-entities/memberships/${id}`,
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
}
