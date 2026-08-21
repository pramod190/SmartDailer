package com.smartdialer.repository;

import com.smartdialer.domain.Call;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface CallRepository { void save(Call call); Optional<Call> find(UUID id); Collection<Call> all(); }