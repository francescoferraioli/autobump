#!/usr/bin/env bash

AUTOBUMPS=$(echo $AUTOBUMP_RUN | tr "#" "\n")

for AUTOBUMP in $AUTOBUMPS; do

    echo "> AUTOBUMP: [$AUTOBUMP]"

    BRANCH=$(           echo "${AUTOBUMP}" | sed 's/\(.*\):.*/\1/')
    BRANCH_BUMPS=$(     echo "${AUTOBUMP}" | sed 's/.*:\(.*\)/\1/' | tr ";" "\n")

    echo "> BRANCH: [$BRANCH]"

    git checkout $BRANCH

    for BRANCH_BUMP in $BRANCH_BUMPS; do

        NAME=$(     echo "${BRANCH_BUMP}" | sed 's/\(.*\)|.*|.*|.*/\1/')
        DIR=$(      echo "${BRANCH_BUMP}" | sed 's/.*|\(.*\)|.*|.*/\1/')
        BUMP=$(     echo "${BRANCH_BUMP}" | sed 's/.*|.*|\(.*\)|.*/\1/')
        VERSION=$(  echo "${BRANCH_BUMP}" | sed 's/.*|.*|.*|\(.*\)/\1/')

        echo "> NAME: [$NAME]"
        echo "> DIR: [$DIR]"
        echo "> BUMP: [$BUMP]"
        echo "> VERSION: [$VERSION]"

        [ ! -z "$DIR" ] && pushd $DIR
        npm version $VERSION
        git add package.json
        [ -f "package-lock.json" ] && git add package-lock.json
        git commit -m "Bump $BUMP on $NAME ($VERSION)"
        [ ! -z "$DIR" ] && popd

    done

    git pull --rebase

    git push

done