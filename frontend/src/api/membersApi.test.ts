import { describe, expect, it, vi } from 'vitest';
import {
  createMember,
  createMemberNote,
  createMemberNumber,
  listMemberNotes,
  MemberApiError,
  MemberApiNetworkError,
  MemberNumberConflictError,
  updateMember,
  type AuthenticatedRequest,
  type CreateMemberPayload,
  type MemberDetailDTO,
  type MemberNoteDTO,
} from './membersApi';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('membersApi', () => {
  describe('createMemberNumber', () => {
    it('generates a string starting with M followed by 31 hex characters', () => {
      const number = createMemberNumber();
      expect(number).toMatch(/^M[0-9a-f]{31}$/i);
      expect(number).toHaveLength(32);
      expect(number).not.toContain('-');
    });
  });

  describe('createMember', () => {
    const payload: CreateMemberPayload = {
      member_number: 'M1234567890123456789012345678901',
      full_name: 'Elena Morales',
      phone: '5551112233',
      email: 'elena@example.com',
    };

    const createdDTO: MemberDetailDTO = {
      id: 'member-uuid-1',
      member_number: payload.member_number,
      full_name: payload.full_name,
      preferred_name: null,
      phone: payload.phone,
      email: payload.email!,
      status: 'active',
      joined_on: '2026-10-27',
      credit_balance_minor: 0,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      photo_url: null,
      birth_date: null,
      notes: null,
      pending_balance_minor: 0,
      has_pending_balance: false,
    };

    it('sends POST /api/v1/members with Content-Type: application/json and returns created member', async () => {
      const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
        expect(path).toBe('/api/v1/members');
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(init?.body as string)).toEqual(payload);
        return jsonResponse(createdDTO, 201);
      });

      const result = await createMember(mockRequest, payload);
      expect(result).toEqual(createdDTO);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('reconciles on 409 conflict when existing record matches member_number, full_name, and phone', async () => {
      const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
        if (path === '/api/v1/members' && init?.method === 'POST') {
          return jsonResponse({ error: { message: 'Member number conflict' } }, 409);
        }
        if (path.startsWith('/api/v1/members?')) {
          expect(path).toContain(`search=${encodeURIComponent(payload.member_number)}`);
          return jsonResponse({
            items: [createdDTO],
            total: 1,
            page: 1,
            limit: 100,
            pages: 1,
          });
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      const result = await createMember(mockRequest, payload);
      expect(result).toEqual(createdDTO);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('throws MemberNumberConflictError on 409 when number exists for a different member', async () => {
      const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
        if (path === '/api/v1/members' && init?.method === 'POST') {
          return jsonResponse({ error: { message: 'Member number conflict' } }, 409);
        }
        if (path.startsWith('/api/v1/members?')) {
          return jsonResponse({
            items: [{
              ...createdDTO,
              id: 'different-uuid',
              full_name: 'Other Person',
              phone: '5559998877',
            }],
            total: 1,
            page: 1,
            limit: 100,
            pages: 1,
          });
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      await expect(createMember(mockRequest, payload)).rejects.toThrow(MemberNumberConflictError);
    });

    it('throws MemberApiNetworkError on 409 when search returns no match or fails', async () => {
      const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
        if (path === '/api/v1/members' && init?.method === 'POST') {
          return jsonResponse({ error: { message: 'Member number conflict' } }, 409);
        }
        if (path.startsWith('/api/v1/members?')) {
          return jsonResponse({ items: [], total: 0, page: 1, limit: 100, pages: 1 });
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      await expect(createMember(mockRequest, payload)).rejects.toThrow(MemberApiNetworkError);
    });

    it('throws MemberApiError on 422 or 500 error responses', async () => {
      const mockRequest = vi.fn<AuthenticatedRequest>(async () => {
        return jsonResponse({ detail: [{ msg: 'field required', loc: ['body', 'phone'] }] }, 422);
      });

      await expect(createMember(mockRequest, payload)).rejects.toThrow(MemberApiError);
    });
  });

  describe('updateMember', () => {
    it('sends PATCH /api/v1/members/{memberId} with Content-Type: application/json', async () => {
      const updatedDTO: MemberDetailDTO = {
        id: 'member-1',
        member_number: 'M100',
        full_name: 'Elena Morales Updated',
        preferred_name: null,
        phone: '5559998877',
        email: null,
        status: 'active',
        joined_on: '2026-10-27',
        credit_balance_minor: 0,
        emergency_contact_name: null,
        emergency_contact_phone: null,
        photo_url: null,
        birth_date: null,
        notes: null,
        pending_balance_minor: 0,
        has_pending_balance: false,
      };

      const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
        expect(path).toBe('/api/v1/members/member-1');
        expect(init?.method).toBe('PATCH');
        expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(init?.body as string)).toEqual({
          full_name: 'Elena Morales Updated',
          phone: '5559998877',
          email: null,
        });
        return jsonResponse(updatedDTO, 200);
      });

      const result = await updateMember(mockRequest, 'member-1', {
        full_name: 'Elena Morales Updated',
        phone: '5559998877',
        email: null,
      });
      expect(result).toEqual(updatedDTO);
    });
  });

  describe('member notes', () => {
    it('listMemberNotes fetches GET /api/v1/members/{memberId}/notes', async () => {
      const notes: MemberNoteDTO[] = [
        {
          id: 'note-1',
          member_id: 'member-1',
          author_id: 'admin-1',
          body: 'First note',
          created_at: '2026-10-27T10:00:00Z',
          voided_at: null,
          voided_by: null,
          is_voided: false,
        },
      ];

      const mockRequest = vi.fn<AuthenticatedRequest>(async (path) => {
        expect(path).toBe('/api/v1/members/member-1/notes');
        return jsonResponse(notes, 200);
      });

      const result = await listMemberNotes(mockRequest, 'member-1');
      expect(result).toEqual(notes);
    });

    it('createMemberNote sends POST /api/v1/members/{memberId}/notes with Content-Type: application/json', async () => {
      const createdNote: MemberNoteDTO = {
        id: 'note-2',
        member_id: 'member-1',
        author_id: 'admin-1',
        body: 'New management note',
        created_at: '2026-10-27T10:05:00Z',
        voided_at: null,
        voided_by: null,
        is_voided: false,
      };

      const mockRequest = vi.fn<AuthenticatedRequest>(async (path, init) => {
        expect(path).toBe('/api/v1/members/member-1/notes');
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(init?.body as string)).toEqual({ body: 'New management note' });
        return jsonResponse(createdNote, 201);
      });

      const result = await createMemberNote(mockRequest, 'member-1', 'New management note');
      expect(result).toEqual(createdNote);
    });
  });
});
