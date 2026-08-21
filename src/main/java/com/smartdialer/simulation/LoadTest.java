package com.smartdialer.simulation;

import com.smartdialer.domain.*;
import com.smartdialer.repository.*;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class LoadTest {
    public static void main(String[] args) throws Exception {
        for (int size : new int[] {100, 1000, 10000}) {
            InMemoryAgentRepository repository = new InMemoryAgentRepository();
            for (int i = 0; i < size; i++) repository.add(new Agent(UUID.randomUUID(), "load", AgentState.AVAILABLE));
            long start = System.nanoTime(); ExecutorService pool = Executors.newFixedThreadPool(Math.min(100, size));
            AtomicInteger successful = new AtomicInteger();
            for (int i = 0; i < size; i++) pool.submit(() -> { if (repository.reserveAvailable("load", Duration.ofSeconds(10)).isPresent()) successful.incrementAndGet(); });
            pool.shutdown(); pool.awaitTermination(1, TimeUnit.MINUTES);
            double elapsedMs = (System.nanoTime() - start) / 1_000_000.0;
            System.out.printf("Load %d agents: reservations=%d elapsedMs=%.2f throughput=%.0f reservations/sec%n", size, successful.get(), elapsedMs, successful.get() / Math.max(.001, elapsedMs / 1000));
        }
        System.out.println("Bottleneck: in-memory scan/contention grows with worker count; PostgreSQL should use indexed conditional updates and SKIP LOCKED, then partition campaigns before adding more workers.");
    }
}