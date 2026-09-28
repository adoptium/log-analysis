This is a simple summary of the state of the project a few weeks before hand-off.

# What was delivered

- A `LogEvents` data structure to contain Log information and accompanying `JenkinsLogParser` class to parse a log file into a list of `LogEvents`, using Regex.
- A `TemplateExtractor` layer which assigns log events `Drain3` template ids for organization.
- A `RuleSet` layer which allows application of rules to ignore/tag/prioritize certain events.

# What's partially completed

# Future enhancements

# Known limitations

# Notes for future maintainers
