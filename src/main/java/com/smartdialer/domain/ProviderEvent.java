package com.smartdialer.domain;

public record ProviderEvent(String eventId, ProviderEventType type, long sequence) { }