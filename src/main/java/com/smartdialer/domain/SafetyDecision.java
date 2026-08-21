package com.smartdialer.domain;

public record SafetyDecision(Decision decision, int approvedCalls, String reason) {
    public enum Decision { APPROVE, REDUCE, REJECT, FALLBACK_PROGRESSIVE }
}