package com.smartdialer;

import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration;

@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class, FlywayAutoConfiguration.class})
public class SmartDialerApplication {
    public static void main(String[] args) {
        org.springframework.boot.SpringApplication.run(SmartDialerApplication.class, args);
    }
}