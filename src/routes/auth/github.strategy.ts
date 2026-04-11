/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import envConfig from '../../shared/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor() {
    super({
      clientID: envConfig.GITHUB_CLIENT_ID,
      clientSecret: envConfig.GITHUB_CLIENT_SECRET,
      callbackURL: envConfig.GITHUB_CLIENT_CALLBACK_URL,
      scope: ['user:email', 'read:user'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    const { id, username, displayName, photos, emails } = profile;

    // Dữ liệu từ github
    const userProfile = {
      githubId: id,
      githubUsername: username,
      name: displayName || username,
      avatarUrl: photos?.[0]?.value,
      email: emails?.[0]?.value,
      githubAccessToken: accessToken,
    };

    return userProfile;
  }
}
