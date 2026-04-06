/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';

import envConfig from '../../shared/config';
@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor() {
    super({
      // Sử dụng envConfig thay vì process.env trực tiếp
      clientID: envConfig.GITHUB_CLIENT_ID,
      clientSecret: envConfig.GITHUB_CLIENT_SECRET,
      callbackURL: envConfig.GITHUB_CLIENT_CALLBACK_URL,
      scope: ['user:email', 'read:user'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    const { id, username, displayName, photos, emails } = profile;

    // Đóng gói dữ liệu trả về từ GitHub
    const userProfile = {
      githubId: id,
      githubUsername: username,
      name: displayName || username,
      avatarUrl: photos?.[0]?.value,
      email: emails?.[0]?.value,
      githubAccessToken: accessToken, // <-- Gói thêm chìa khóa này mang theo
    };

    // Truyền dữ liệu này sang cho AuthController xử lý tiếp
    return userProfile;
  }
}
