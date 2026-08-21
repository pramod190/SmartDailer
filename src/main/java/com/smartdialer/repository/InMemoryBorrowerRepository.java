package com.smartdialer.repository;

import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemoryBorrowerRepository implements BorrowerRepository {
    private final Map<String, ConcurrentLinkedQueue<String>> byCampaign = new ConcurrentHashMap<>();
    private final Set<String> reserved = ConcurrentHashMap.newKeySet();
    public void add(String campaignId, String borrowerId) { byCampaign.computeIfAbsent(campaignId, ignored -> new ConcurrentLinkedQueue<>()).add(borrowerId); }
    public Optional<String> reserveEligible(String campaignId) {
        var queue = byCampaign.getOrDefault(campaignId, new ConcurrentLinkedQueue<>());
        for (String borrower : queue) if (reserved.add(borrower)) return Optional.of(borrower);
        return Optional.empty();
    }
    public void release(String borrowerId) { reserved.remove(borrowerId); }
}