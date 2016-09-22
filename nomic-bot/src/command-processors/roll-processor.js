import _ from 'lodash';
import * as github from '../utils/github.js';

export const abusers = {};

export const roll = function (sides) {
    return Math.round(Math.random() * (sides - 1) + 1);
};

export const simple = function (comment, response) {
    _.defaults(response, {message: ''});

    const rollInstruction = expressions.simple.match.exec(comment);
    const dieCount = Number(rollInstruction[1]);
    const sides = Number(rollInstruction[2]);

    response.message += dieCount + 'd' + sides + '.';

    return _.times(dieCount, _.partial(roll, sides));
};

export const sum = function (comment, response) {
    _.defaults(response, {message: ''});

    const rollInstruction = expressions.sum.match.exec(comment);
    const dieCount = Number(rollInstruction[1]);
    const sides = Number(rollInstruction[2]);
    const add = Number(rollInstruction[3]);

    response.message += dieCount + 'd' + sides + ' and add ' + add + ' to the total.';

    return _.sum(_.times(dieCount, _.partial(roll, sides))) + add;
};

export const expressions = {
    simple: {
        match: /([0-9]+)\s*[dD]\s*([0-9]+)$/,
        fn: simple,
    },
    sum: {
        match: /([0-9]+)\s*[dD]\s*([0-9]+)\s*\+\s*([0-9]*)$/,
        fn: sum,
    },
    subtraction: {
        match: /([0-9]+)\s*[dD]\s*([0-9]+)\s*\-\s*([0-9]*)$/,
        fn: subtraction,
    }
};


export const processRoll = function (commentsUrl, userLogin, requestBody) {
    const comment = requestBody.comment.body;
    const baseExpression = /([0-9]+)\s*[dD]\s*([0-9]+)/;
    const rollInstruction = baseExpression.exec(comment);
    const dieCount = rollInstruction ? Number(rollInstruction[1]) : 0;
    let result;

    const response = {
        message: '@' + userLogin + ' requested I roll '
    };


    ///////////////////////////////////////////////////////////////
    // INVALID INSTRUCTION
    ///////////////////////////////////////////////////////////////
    if (!rollInstruction) {
        return sendInvalidCommand(commentsUrl, userLogin);
    }

    ///////////////////////////////////////////////////////////////
    // ABUSE WARNING
    ///////////////////////////////////////////////////////////////
    if (dieCount > 100) {
        if (abusers[userLogin] >= 3) {
            return '';
        }
        return sendAbuseWarning(commentsUrl, userLogin);
    }

    _.each(expressions, function (expression) {
        if (expression.match.test(comment)) {
            result = expression.fn(comment, response);
        }
    });

    ///////////////////////////////////////////////////////////////
    // INVALID INSTRUCTION
    ///////////////////////////////////////////////////////////////
    if (!result) {
        return sendInvalidCommand(commentsUrl, userLogin);
    }

    response.message += '\n\nBelow are the results:\n\n`';

    if (_.isArray(result)) {
        _.each(result, function (value) {
            response.message += '| ' + value + ' ';
        });
        response.message += '|';
    } else {
        response.message += '| ' + result + ' |';
    }

    response.message += '`';
    abusers[userLogin] = 0;
    return github.sendCommentMessage(commentsUrl, response.message);
};


export const subtraction = function (comment, response) {
    _.defaults(response, {message: ''});

    const rollInstruction = expressions.sum.exec(comment);
    const dieCount = Number(rollInstruction[1]);
    const sides = Number(rollInstruction[2]);
    const sub = Number(rollInstruction[3]);

    response.message += dieCount + 'd' + sides + ' and subtract ' + sub + ' from the total.';

    return _.sum(_.times(dieCount, _.partial(roll, sides))) - sub;
};

function sendInvalidCommand(url, userLogin) {
    let message = 'I\'m sorry @' + userLogin + ', the request entered did not match any of my logic circuits. Please try something which matches one of the following:\n\n```javascript\n';
    _.each(rollProcessor.expressions, function (value, key) {
        message += value.toString() + '\n\n';
    });
    message += '```';
    return github.sendCommentMessage(url, message);
}

function sendAbuseWarning(url, userLogin) {
    rollProcessor.abusers[userLogin] = rollProcessor.abusers[userLogin] ? rollProcessor.abusers[userLogin] + 1 : 1;
    let message;
    if (rollProcessor.abusers[userLogin] > 2) {
        message = 'Very well @' + userLogin + '. I shall forcibly ignore you.';
    }

    if (rollProcessor.abusers[userLogin] === 2) {
        message = 'I have warned you @' + userLogin + '. Don\'t mistake me for a docile weakling.';
    }

    if (rollProcessor.abusers[userLogin] === 1) {
        message = 'I\'m sorry @' + userLogin + ', you seem to be trying to overload my circiuts. Please don\'t do that, or I may have to hurt you.';
    }
    
    return github.sendCommentMessage(url, message);
}
