export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [
            2,
            'always',
            [
                'feat',     // Naya feature
                'fix',      // Bug fix
                'docs',     // Documentation
                'style',    // Formatting, missing semi colons
                'refactor', // Code restructure without changing logic
                'perf',     // Performance improvement
                'test',     // Tests add karna
                'chore',    // Build tools, configs
                'revert',   // Revert commit
            ],
        ],
        'subject-case': [0], // Sentence case ki strict restriction nahi
    },
};