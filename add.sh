#!/bin/bash

# $1 - filename
# $2 - hash


if [ -z "$3" ]
then
    ip="localhost"
else
    ip=$3
fi


curl -H "Content-type:application/json" --data '{"data" : "'$1'/'$2'"}' http://localhost:3001/mineBlock

