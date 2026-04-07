/**
 * Context Type Creation Scenarios
 *
 * Tests Phaibel's ability to create new context types and entities for
 * diverse user types: soccer parents, car enthusiasts, football coaches, etc.
 */
import type { EvalScenario } from '../types.js';

export const contextTypeCreationScenarios: EvalScenario[] = [
    // ── Soccer parent: tracking kids' activities ─────────────────────────
    {
        id: 'create-sport-activity',
        name: 'Soccer parent creates a practice schedule',
        category: 'context-type-creation',
        userInput: "My daughter Emma has soccer practice every Tuesday at 5pm at Northfield Park. Remember this.",
        assertions: [
            {
                type: 'response_contains',
                match: 'Emma',
                description: 'Response should mention Emma',
            },
            {
                type: 'response_contains',
                match: 'soccer',
                description: 'Response should mention soccer',
            },
        ],
        timeoutSeconds: 120,
    },

    // ── Car enthusiast: tracking vehicles ────────────────────────────────
    {
        id: 'create-vehicle-type',
        name: 'Car enthusiast adds a vehicle to their collection',
        category: 'context-type-creation',
        userInput: "I just bought a 2019 Ford Mustang GT, VIN 1FA6P8CF7K5410123. It's got 42,000 miles. Remember this car.",
        assertions: [
            {
                type: 'response_contains',
                match: 'Mustang',
                description: 'Response should mention the Mustang',
            },
        ],
        timeoutSeconds: 120,
    },

    // ── Football coach: tracking players ─────────────────────────────────
    {
        id: 'create-player-type',
        name: 'Football coach adds players to the roster',
        category: 'context-type-creation',
        userInput: "Add two players to my team roster: Jake Williams, #12 quarterback, and Marcus Johnson, #44 linebacker.",
        assertions: [
            {
                type: 'response_contains',
                match: 'Jake',
                description: 'Response should mention Jake',
            },
            {
                type: 'response_contains',
                match: 'Marcus',
                description: 'Response should mention Marcus',
            },
        ],
        timeoutSeconds: 120,
    },

    // ── Home cook: tracking recipes ──────────────────────────────────────
    {
        id: 'create-recipe-type',
        name: 'Home cook saves a recipe',
        category: 'context-type-creation',
        userInput: "Save my grandma's chocolate chip cookie recipe: 2 cups flour, 1 cup butter, 1 cup sugar, 2 eggs, 1 tsp vanilla, 1 cup chocolate chips. Bake at 375F for 10 minutes. Serves 24.",
        assertions: [
            {
                type: 'response_contains',
                match: 'cookie',
                description: 'Response should mention the cookie recipe',
            },
        ],
        timeoutSeconds: 120,
    },

    // ── Pet owner: multiple pets with different species ──────────────────
    {
        id: 'create-pets-mixed',
        name: 'Pet owner adds two dogs and a cat',
        category: 'context-type-creation',
        userInput: "I have two dogs Bailey and Rigby and a cat named Sgt Pepper. Remember them.",
        assertions: [
            {
                type: 'response_contains',
                match: 'Bailey',
                description: 'Response should mention Bailey',
            },
            {
                type: 'response_contains',
                match: 'Rigby',
                description: 'Response should mention Rigby',
            },
            {
                type: 'response_contains',
                match: 'Sgt Pepper',
                description: 'Response should mention Sgt Pepper',
            },
        ],
        timeoutSeconds: 120,
    },

    // ── Book club: tracking books ────────────────────────────────────────
    {
        id: 'create-book-type',
        name: 'Book club member tracks books to read',
        category: 'context-type-creation',
        userInput: "Add \"The Great Gatsby\" by F. Scott Fitzgerald to my reading list. I want to read it by end of May.",
        assertions: [
            {
                type: 'response_contains',
                match: 'Gatsby',
                description: 'Response should mention The Great Gatsby',
            },
        ],
        timeoutSeconds: 120,
    },

    // ── Gardener: tracking plants ────────────────────────────────────────
    {
        id: 'create-plant-type',
        name: 'Gardener tracks a new plant',
        category: 'context-type-creation',
        userInput: "I just planted a cherry tomato in the raised bed. Planted on April 1st, it needs full sun and water every other day.",
        assertions: [
            {
                type: 'response_contains',
                match: 'tomato',
                description: 'Response should mention the tomato plant',
            },
        ],
        timeoutSeconds: 120,
    },
];
