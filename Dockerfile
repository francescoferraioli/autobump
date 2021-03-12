FROM node:14-alpine as builder

RUN mkdir -p /opt/autobump/dist

WORKDIR /opt/autobump

COPY . /opt/autobump/

RUN yarn install --frozen-lockfile && yarn run build

FROM node:14-alpine as runner

LABEL com.github.actions.name="Auto-bump pull requests with changes from their base branch"
LABEL com.github.actions.description="A GitHub Action that auto-bumps PRs with changes from their base branch"
LABEL com.github.actions.icon="git-pull-request"
LABEL com.github.actions.color="blue"

RUN apk add --update --no-cache ca-certificates \
  && mkdir -p /opt/autobump

WORKDIR /opt/autobump

COPY --from=builder /opt/autobump/dist/index.js /opt/autobump/index.js

ENTRYPOINT [ "node", "/opt/autobump/index.js" ]
