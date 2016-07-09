import _ from 'lodash';
import stringFormat from 'string-format';
import github from '../utils/github.js';
import logger from '../utils/logger.js';
import voteProcessor from '../command-processors/vote-processor.js';
const closeProcessor = {
    messages: {
        notOwner: '@{login}, you cannot close a proposal which you did not create.',
        notActive: '@{login}, you cannot close the proposal because you are not an active player.'
    },
    processClose: function (commentsUrl, userLogin, requestBody) {
        const issue = requestBody.issue;

        if (issue.user.login !== userLogin) {
            return github.sendCommentMessage(commentsUrl, stringFormat(closeProcessor.messages.notOwner, {login: userLogin}));
        }
        
        return github.getPlayerData()
        .then(function (playerData) {
            const activePlayers = playerData.activePlayers, labels = _.map(_.remove(issue.labels, {name: voteProcessor.labelTitles.open}), 'name');
              
            if (!_.find(activePlayers, {name: userLogin})) {
                return github.sendCommentMessage(commentsUrl, stringFormat(closeProcessor.messages.notActive, {login: userLogin}));
            }
            
            return github.patch({
                path: issue.url,
                data: {
                    state: 'closed',
                    labels: labels
                }
            }).catch(logger.error);
        });
    }
};

export default closeProcessor;