package com.smartdialer.repository;

import com.smartdialer.domain.Call;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemoryCallRepository implements CallRepository {
    private final Map<UUID, Call> calls = new ConcurrentHashMap<>();
    public void save(Call call) { calls.put(call.id(), call); }
    public Optional<Call> find(UUID id) { return Optional.ofNullable(calls.get(id)); }
    public Collection<Call> all() { return List.copyOf(calls.values()); }
}