import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/errors.ts';
import type { ChatMessage } from '../llm/types.ts';

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
  messages: ChatMessage[];
}

export interface SessionStoreOptions {
  ttlMs: number;
  maxMessages: number;
}

export interface SessionStore {
  create(systemPrompt?: string): Session;
  get(id: string): Session | undefined;
  require(id: string): Session;
  remove(id: string): boolean;
  append(session: Session, ...messages: ChatMessage[]): void;
  sweep(now?: number): number;
  size(): number;
}

export function createSessionStore({ ttlMs, maxMessages }: SessionStoreOptions): SessionStore {
  const sessions = new Map<string, Session>();

  function isExpired(session: Session, now: number): boolean {
    return now - session.updatedAt > ttlMs;
  }

  function trim(session: Session): void {
    if (session.messages.length <= maxMessages) return;
    let start = session.messages.length - maxMessages;
    while (start < session.messages.length && session.messages[start]?.role === 'tool') {
      start += 1;
    }
    session.messages.splice(0, start);
  }

  function get(id: string): Session | undefined {
    const session = sessions.get(id);
    if (!session) return undefined;
    if (isExpired(session, Date.now())) {
      sessions.delete(id);
      return undefined;
    }
    return session;
  }

  function create(systemPrompt?: string): Session {
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    if (systemPrompt) session.systemPrompt = systemPrompt;
    sessions.set(session.id, session);
    return session;
  }

  function requireSession(id: string): Session {
    const session = get(id);
    if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with id "${id}".`);
    return session;
  }

  function append(session: Session, ...messages: ChatMessage[]): void {
    session.messages.push(...messages);
    trim(session);
    session.updatedAt = Date.now();
  }

  function sweep(now = Date.now()): number {
    let removed = 0;
    for (const [id, session] of sessions) {
      if (isExpired(session, now)) {
        sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  return {
    create,
    get,
    require: requireSession,
    remove(id) {
      return sessions.delete(id);
    },
    append,
    sweep,
    size() {
      return sessions.size;
    },
  };
}
