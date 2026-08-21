package com.smartdialer.repository;

import java.util.Optional;

public interface BorrowerRepository { Optional<String> reserveEligible(String campaignId); void add(String campaignId, String borrowerId); void release(String borrowerId); }