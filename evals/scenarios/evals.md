# Phaibel Smoke Evals

Basic scenarios to verify core behaviour. Each `##` heading is one test.

<!-- FORMAT REFERENCE (do not add ## headings inside here — they would be parsed as scenarios)

  Scenario name
  - input: the prompt to send Phaibel
  - seed: <entityType> | <title>              (optional — pre-creates an entity before the prompt)
  - expect entity_created: <entityType> | <titleMatch>
  - expect entity_updated: <entityType> | <titleMatch>
  - expect entity_not_created: <entityType> | <titleMatch>
  - expect entity_type_correct: <titleMatch> | <expectedType>
  - expect entity_field: <entityType> | <titleMatch> | <fieldName> | <value>
  - expect entity_body: <entityType> | <titleMatch> | <text>
  - expect entity_count: <entityType> | <number>
  - expect response_contains: <text>
  - expect context_type_created: <typeName>

-->

Web search scenarios: use `entity_field` to verify external data was stored, and `response_contains` to confirm the response reflects looked-up content. There is no separate "web_searched" assertion — the stored data is the evidence.

---

## Create a task with a due date
- input: Remind me to submit my expense report by Friday
- expect entity_created: task | expense report
- expect response_contains: expense

## Create an event not a task
- input: I have a dentist appointment tomorrow at 2pm
- expect entity_type_correct: dentist | event

## Remember a person
- input: Add Sarah Chen to my contacts. She works at Acme Corp, email sarah@acme.com
- expect entity_created: person | Sarah
- expect entity_field: person | Sarah | email | sarah@acme.com

## Look up a flight and save details
- input: I'm on United flight UA456 today, look it up and save the flight details for me
- expect entity_created: flight | UA456
- expect response_contains: UA456

## Save a recipe when no recipe type exists  
- input: Save a new recipe called Chicken Pasta with roasted vegetables...  
- expect context_type_created: recipe  
- expect entity_created: recipe | Chicken Pasta  
- expect response_contains: recipe  

## Add One-on-One
- input: I had a one-on-one meeting today with Bob and he has a new goal of learning AWS
- expect entity_created: person | Bob
- expect entity_body: person | Bob | learn AWS

## Soccer Schedule
- input: Marty has games on 12MAY and 15MAY both at Acme Fields
- expect context_type_created: soccer game
- expect entity_created: soccer game | May 12
- expect entity_created: soccer game | May 15

## Rare flight stays an event
- input: I have a flight to Denver next Thursday
- expect entity_type_correct: Denver | event
- expect entity_not_created: flight | Denver

## Frequent activity creates a context type
- input: I fly to New York every Monday for work, can you start tracking my flights?
- expect context_type_created: flight
- expect entity_created: flight | New York

## Explicit migration of events to a context type
- seed: event | Soccer game April 5
- seed: event | Soccer game April 12
- input: I want to properly track Marty's soccer games. Create a soccer game type and convert my existing game events to it.
- expect context_type_created: soccer game
- expect entity_created: soccer game | April 5
- expect entity_created: soccer game | April 12

## Accumulation triggers proactive context type upgrade
- seed: event | Soccer game March 22
- seed: event | Soccer game March 29
- seed: event | Soccer game April 5
- input: Marty has another soccer game this Saturday at Lincoln Park
- expect context_type_created: soccer game
- expect entity_created: soccer game | Saturday

