package com.smartdialer.domain;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

public final class Call {
    private final UUID id;
    private final UUID agentId;
    private final String borrowerId;
    private CallState state = CallState.QUEUED;
    private final Set<String> processedEvents = new HashSet<>();

    public Call(UUID id, UUID agentId, String borrowerId) { this.id = id; this.agentId = agentId; this.borrowerId = borrowerId; }
    public UUID id() { return id; }
    public UUID agentId() { return agentId; }
    public String borrowerId() { return borrowerId; }
    public synchronized CallState state() { return state; }
    public synchronized boolean applyEvent(String eventId, ProviderEventType event) {
        if (!processedEvents.add(eventId) || state.isTerminal()) return false;
        CallState next = switch (event) {
            case RINGING -> CallState.RINGING;
            case ANSWERED -> CallState.ANSWERED;
            case CONNECTED -> CallState.CONNECTED;
            case COMPLETED -> CallState.COMPLETED;
            case FAILED -> CallState.FAILED;
            case CANCELLED -> CallState.CANCELLED;
        };
        if (!validTransition(state, next)) return false;
        state = next;
        return true;
    }
    public synchronized void moveTo(CallState next) {
        if (state.isTerminal() || !validTransition(state, next))
            throw new IllegalStateException("Invalid call transition: " + state + " -> " + next);
        state = next;
    }
    private boolean isForwardProgress(CallState next) { return next.ordinal() >= state.ordinal(); }
    private boolean validTransition(CallState from, CallState to) {
        return switch (from) {
            case QUEUED -> to == CallState.RESERVED || to == CallState.CANCELLED;
            case RESERVED -> to == CallState.INITIATED || to == CallState.CANCELLED || to == CallState.FAILED;
            case INITIATED -> to == CallState.RINGING || to == CallState.FAILED || to == CallState.CANCELLED;
            case RINGING -> to == CallState.ANSWERED || to == CallState.COMPLETED || to == CallState.FAILED || to == CallState.CANCELLED;
            case ANSWERED -> to == CallState.CONNECTED || to == CallState.COMPLETED || to == CallState.FAILED;
            case CONNECTED -> to == CallState.COMPLETED || to == CallState.FAILED;
            default -> false;
        };
    }
    public synchronized Set<String> processedEvents() { return Collections.unmodifiableSet(new HashSet<>(processedEvents)); }
}