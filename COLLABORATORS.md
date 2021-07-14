# Apollo OSS Collaborator Guidelines

Thanks for helping make Apollo OSS better! Here are a few quick repo maintenance guidelines intended to help keep Apollo projects happy and healthy.

## Overall

- Please remember to be polite and respectful to all community members, no matter what is being reported, contributed, etc. People who are taking time out of their lives to participate in the Apollo ecosystem should feel welcomed, included and appreciated.

## Issues

- Issues are for bugs only. All other requests should be redirected accordingly, then closed. Feature requests have their own [repo](https://github.com/apollographql/apollo-feature-requests), and requests for help should go to [our community forums](https://community.apollographql.com) or [Stack Overflow](http://stackoverflow.com).
- If a bug report is valid, add the `confirmed` label, and optionally decide if community help should be requested using the `help-wanted` label. If you’re planning on working on it, assign the issue to yourself.
- If an issue isn’t easily reproducible, ask for a reproduction and add a `reproduction-needed` label.
- If a reproduction has been asked for but hasn’t been received in 1 week, close the issue.

## Pull Requests

* Ensure PR’s have tests (when it makes sense, which is almost always).
* Make sure `CHANGELOG`’s are updated/maintained. Either request that the PR author adds a `CHANGELOG` entry, or add one yourself. Make sure the PR is referenced along with their GitHub username, and link to their profile (to give them extra kudos).
* Don’t forget to consider how a PR you’re merging will affect the docs; either ask contributors for docs changes, open a new issue to track outstanding changes, or consider implementing the docs changes yourself.
* Always think about backwards compatibility; please don’t merge PR’s that require major version bumps, unless talking it over with the core team.
* If the PR has a small number of commits, or a large number of semantically unimportant commits, squash and merge the PR. If the PR commits are well thought out, isolated and would add value to the git history if kept separate, do a merge commit.
