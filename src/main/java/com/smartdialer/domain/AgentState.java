package com.smartdialer.domain;

public enum AgentState {
    OFFLINE, AVAILABLE, RESERVED, DIALING, CONNECTED, WRAP_UP, PAUSED;

    public boolean canTransitionTo(AgentState next) {
        return switch (this) {
            case OFFLINE -> next == AVAILABLE;
            case AVAILABLE -> next == RESERVED || next == PAUSED || next == OFFLINE;
            case RESERVED -> next == DIALING || next == AVAILABLE || next == OFFLINE;
            case DIALING -> next == CONNECTED || next == AVAILABLE || next == OFFLINE;
            case CONNECTED -> next == WRAP_UP;
            case WRAP_UP -> next == AVAILABLE || next == OFFLINE;
            case PAUSED -> next == AVAILABLE || next == OFFLINE;
        };
    }
}