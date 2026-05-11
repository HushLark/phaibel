# Phaibel Smoke Evals

Basic scenarios to verify core behaviour. Each `##` heading is one test.

## Format reference (delete this section before running)
```
## Scenario name
- input: the prompt to send Phaibel
- seed: <entityType> | <title>              (optional — pre-creates an entity before the prompt)
- expect entity_created: <entityType> | <titleMatch>
- expect entity_updated: <entityType> | <titleMatch>
- expect entity_not_created: <entityType> | <titleMatch>
- expect entity_type_correct: <titleMatch> | <expectedType>
- expect entity_field: <entityType> | <titleMatch> | <fieldName> | <value>
- expect entity_count: <entityType> | <number>
- expect response_contains: <text>
- expect context_type_created: <typeName>
```

---

## Save a recipe
- input: Save a new recipe called Chicken Pasta with Roasted Vegetables. Ingredients: chicken breasts, protein pasta, spinach, broccoli, garlic, olive oil, lemon. Cook at 425F for 20 minutes.
- expect entity_created: recipe | Chicken Pasta
- expect response_contains: recipe

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
