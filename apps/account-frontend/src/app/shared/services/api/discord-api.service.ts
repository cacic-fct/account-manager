import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type {
  DiscordAuthUrl,
  DiscordLinkStatus,
  DiscordManagedRoleDefinition,
  DiscordManagedRoleOverride,
  DiscordManagedRoleOverrideCreateRequest,
  DiscordManagedRoleOverrideUpdateRequest,
  DiscordRole,
  RoleSelectionResponse,
  SelectableRoles,
  ServerSetting,
  UpdateRoleSelection,
  UpdateServerSetting,
  UserRoleSelection,
  UserRoles,
} from '@cacic/shared-types';
import { CacheService } from '../cache.service';
import { getApiBaseUrl } from '../../utils/api-url.util';
import { API_CACHE_DURATIONS, API_CACHE_KEYS } from './api-cache.constants';

@Injectable({
  providedIn: 'root',
})
export class DiscordApiService {
  private readonly baseUrl = getApiBaseUrl();
  private http = inject(HttpClient);
  private cacheService = inject(CacheService);

  getDiscordAuthUrl(): Observable<DiscordAuthUrl> {
    return this.http.get<DiscordAuthUrl>(`${this.baseUrl}/discord/auth-url`, {
      withCredentials: true,
    });
  }

  getDiscordLinkStatus(): Observable<DiscordLinkStatus> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.DISCORD_STATUS,
      () =>
        this.http.get<DiscordLinkStatus>(`${this.baseUrl}/discord/status`, {
          withCredentials: true,
        }),
      API_CACHE_DURATIONS.DISCORD_STATUS,
    );
  }

  unlinkDiscord(linkId: string): Observable<{ message: string }> {
    return this.http
      .delete<{ message: string }>(`${this.baseUrl}/discord/link/${linkId}`, {
        withCredentials: true,
      })
      .pipe(
        tap(() => {
          this.cacheService.invalidate(API_CACHE_KEYS.DISCORD_STATUS);
        }),
      );
  }

  getDiscordAdminStatus(): Observable<{ isAdmin: boolean }> {
    return this.http.get<{ isAdmin: boolean }>(`${this.baseUrl}/discord/admin/status`, {
      withCredentials: true,
    });
  }

  getServerSettings(): Observable<ServerSetting[]> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.SERVER_SETTINGS,
      () =>
        this.http.get<ServerSetting[]>(`${this.baseUrl}/discord/admin/settings`, {
          withCredentials: true,
        }),
      API_CACHE_DURATIONS.SERVER_SETTINGS,
    );
  }

  updateServerSetting(key: string, setting: UpdateServerSetting): Observable<ServerSetting> {
    return this.http
      .put<ServerSetting>(`${this.baseUrl}/discord/admin/settings/${key}`, setting, {
        withCredentials: true,
      })
      .pipe(
        tap(() => {
          this.cacheService.invalidate(API_CACHE_KEYS.SERVER_SETTINGS);
        }),
      );
  }

  getDiscordRolesAdmin(): Observable<SelectableRoles> {
    return this.http.get<SelectableRoles>(`${this.baseUrl}/discord/roles/admin`, {
      withCredentials: true,
    });
  }

  updateDiscordRoleSelection(dto: UpdateRoleSelection): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/discord/roles/admin/selection`, dto, {
      withCredentials: true,
    });
  }

  syncDiscordRoles(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/discord/roles/admin/sync`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  getDiscordManagedRoleCatalog(): Observable<DiscordManagedRoleDefinition[]> {
    return this.http.get<DiscordManagedRoleDefinition[]>(
      `${this.baseUrl}/discord/roles/admin/managed-role-overrides/catalog`,
      {
        withCredentials: true,
      },
    );
  }

  getDiscordManagedRoleOverrides(): Observable<DiscordManagedRoleOverride[]> {
    return this.http.get<DiscordManagedRoleOverride[]>(`${this.baseUrl}/discord/roles/admin/managed-role-overrides`, {
      withCredentials: true,
    });
  }

  createDiscordManagedRoleOverride(
    dto: DiscordManagedRoleOverrideCreateRequest,
  ): Observable<DiscordManagedRoleOverride> {
    return this.http.post<DiscordManagedRoleOverride>(
      `${this.baseUrl}/discord/roles/admin/managed-role-overrides`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  updateDiscordManagedRoleOverride(
    id: string,
    dto: DiscordManagedRoleOverrideUpdateRequest,
  ): Observable<DiscordManagedRoleOverride> {
    return this.http.put<DiscordManagedRoleOverride>(
      `${this.baseUrl}/discord/roles/admin/managed-role-overrides/${id}`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  deleteDiscordManagedRoleOverride(id: string): Observable<{ deleted: true; id: string; userId: string }> {
    return this.http.delete<{ deleted: true; id: string; userId: string }>(
      `${this.baseUrl}/discord/roles/admin/managed-role-overrides/${id}`,
      {
        withCredentials: true,
      },
    );
  }

  getSelectableDiscordRoles(): Observable<DiscordRole[]> {
    return this.http.get<DiscordRole[]>(`${this.baseUrl}/discord/roles/selectable`, {
      withCredentials: true,
    });
  }

  getUserDiscordRoles(): Observable<UserRoles> {
    return this.http.get<UserRoles>(`${this.baseUrl}/discord/roles/user`, {
      withCredentials: true,
    });
  }

  updateUserDiscordRoles(dto: UserRoleSelection): Observable<RoleSelectionResponse> {
    return this.http.put<RoleSelectionResponse>(`${this.baseUrl}/discord/roles/user`, dto, {
      withCredentials: true,
    });
  }
}
