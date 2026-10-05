"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase/client";
import { useSync } from "./sync";

export interface Message {
  id: string;
  student_id: string;
  sender_id: string;
  body: string;
  chapter_id: string | null;
  created_at: string;
  read_at: string | null;
  /** Client-only: still sending, or failed to send. */
  pending?: boolean;
  failed?: boolean;
}

/** Signed-in user, and whether they're an admin (the admins table only shows you your own row). */
export function useChatUser() {
  const { user } = useSync();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!supabase || !user?.email) return;
    supabase
      .from("admins")
      .select("email")
      .limit(1)
      .then(({ data }) => setIsAdmin(!!data?.length));
  }, [user?.email]);
  return { user, isAdmin };
}

/** One student's thread: loads history, streams new messages and read receipts live, shows typing. */
export function useThread(studentId: string | null, meId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    if (!supabase || !studentId || !meId) return;
    const sb = supabase;
    let alive = true;
    setLoading(true);
    sb.from("messages")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (!alive) return;
        setMessages(((data ?? []) as Message[]).reverse());
        setLoading(false);
      });

    const upsert = (m: Message) =>
      setMessages((list) => {
        const i = list.findIndex((x) => x.id === m.id);
        if (i === -1) return [...list, m].sort((a, b) => a.created_at.localeCompare(b.created_at));
        const next = [...list];
        next[i] = { ...m, pending: false, failed: false };
        return next;
      });

    const channel = sb
      .channel(`thread:${studentId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `student_id=eq.${studentId}` }, (p) => {
        upsert(p.new as Message);
        if ((p.new as Message).sender_id !== meId) setOtherTyping(false);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `student_id=eq.${studentId}` }, (p) => upsert(p.new as Message))
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.from === meId) return;
        setOtherTyping(true);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setOtherTyping(false), 3500);
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      alive = false;
      clearTimeout(typingTimer.current);
      sb.removeChannel(channel);
      channelRef.current = null;
    };
  }, [studentId, meId]);

  const send = useCallback(
    async (body: string, chapterId: string | null) => {
      if (!supabase || !studentId || !meId || !body.trim()) return;
      const msg: Message = {
        id: crypto.randomUUID(),
        student_id: studentId,
        sender_id: meId,
        body: body.trim(),
        chapter_id: chapterId,
        created_at: new Date().toISOString(),
        read_at: null,
        pending: true,
      };
      setMessages((list) => [...list, msg]); // shows instantly; the realtime echo replaces it
      const { error } = await supabase.from("messages").insert({ id: msg.id, student_id: msg.student_id, sender_id: msg.sender_id, body: msg.body, chapter_id: msg.chapter_id });
      setMessages((list) => list.map((m) => (m.id === msg.id ? { ...m, pending: false, failed: !!error } : m)));
    },
    [studentId, meId],
  );

  const retry = useCallback(
    async (m: Message) => {
      setMessages((list) => list.filter((x) => x.id !== m.id));
      await send(m.body, m.chapter_id);
    },
    [send],
  );

  /** Marks everything the other side sent as read. */
  const markRead = useCallback(async () => {
    if (!supabase || !studentId || !meId) return;
    const unread = messages.some((m) => m.sender_id !== meId && !m.read_at && !m.pending);
    if (!unread) return;
    await supabase.from("messages").update({ read_at: new Date().toISOString() }).eq("student_id", studentId).neq("sender_id", meId).is("read_at", null);
  }, [messages, studentId, meId]);

  /** Tells the other side we're typing (at most every 2s). */
  const typing = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2000 || !channelRef.current) return;
    lastTypingSent.current = now;
    channelRef.current.send({ type: "broadcast", event: "typing", payload: { from: meId } });
  }, [meId]);

  return { messages, loading, otherTyping, send, retry, markRead, typing };
}

/** Unread messages addressed to me (live), for the badge. */
export function useUnread(meId: string | null, isAdmin: boolean | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!supabase || !meId || isAdmin === null) return;
    const sb = supabase;
    const refresh = () => {
      let q = sb.from("messages").select("id", { count: "exact", head: true }).neq("sender_id", meId).is("read_at", null);
      if (!isAdmin) q = q.eq("student_id", meId);
      q.then(({ count }) => setCount(count ?? 0));
    };
    refresh();
    const channel = sb
      .channel(`unread:${meId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", ...(isAdmin ? {} : { filter: `student_id=eq.${meId}` }) }, refresh)
      .subscribe();
    return () => void sb.removeChannel(channel);
  }, [meId, isAdmin]);
  return count;
}
