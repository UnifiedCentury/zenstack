import { loadSchema } from '@zenstackhq/testtools';

describe('Polymorphism Test', () => {
    const schema = `
model User {
    id Int @id @default(autoincrement())
    level Int @default(0)
    assets Asset[]
    ratedVideos RatedVideo[] @relation('direct')

    @@allow('all', true)
}

model Asset {
    id Int @id @default(autoincrement())
    createdAt DateTime @default(now())
    viewCount Int @default(0)
    owner User @relation(fields: [ownerId], references: [id])
    ownerId Int
    assetType String
    
    @@delegate(assetType)
    @@allow('all', true)
}

model Video extends Asset {
    duration Int
    url String
    videoType String

    @@delegate(videoType)
}

model RatedVideo extends Video {
    rating Int
    user User? @relation(name: 'direct', fields: [userId], references: [id])
    userId Int?
}

model Image extends Asset {
    format String
    gallery Gallery? @relation(fields: [galleryId], references: [id])
    galleryId Int?
}

model Gallery {
    id Int @id @default(autoincrement())
    images Image[]
}
`;

    async function setup() {
        const { enhance } = await loadSchema(schema, { logPrismaQuery: true, enhancements: ['delegate'] });
        const db = enhance();

        const user = await db.user.create({ data: { id: 1 } });

        const video = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, duration: 100, url: 'xyz', rating: 100 },
        });

        const videoWithOwner = await db.ratedVideo.findUnique({ where: { id: video.id }, include: { owner: true } });

        return { db, video, user, videoWithOwner };
    }

    it('create hierarchy', async () => {
        const { enhance } = await loadSchema(schema, { logPrismaQuery: true, enhancements: ['delegate'] });
        const db = enhance();

        const user = await db.user.create({ data: { id: 1 } });

        const video = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, duration: 100, url: 'xyz', rating: 100 },
            include: { owner: true },
        });

        expect(video).toMatchObject({
            viewCount: 1,
            duration: 100,
            url: 'xyz',
            rating: 100,
            assetType: 'Video',
            videoType: 'RatedVideo',
            owner: user,
        });

        await expect(db.asset.create({ data: { type: 'Video' } })).rejects.toThrow('is a delegate');
        await expect(db.video.create({ data: { type: 'RatedVideo' } })).rejects.toThrow('is a delegate');

        const image = await db.image.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, format: 'png' },
            include: { owner: true },
        });
        expect(image).toMatchObject({
            viewCount: 1,
            format: 'png',
            assetType: 'Image',
            owner: user,
        });

        // create in a nested payload
        const gallery = await db.gallery.create({
            data: {
                images: {
                    create: [
                        { owner: { connect: { id: user.id } }, format: 'png', viewCount: 1 },
                        { owner: { connect: { id: user.id } }, format: 'jpg', viewCount: 2 },
                    ],
                },
            },
            include: { images: { include: { owner: true } } },
        });
        expect(gallery.images).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    format: 'png',
                    assetType: 'Image',
                    viewCount: 1,
                    owner: user,
                }),
                expect.objectContaining({
                    format: 'jpg',
                    assetType: 'Image',
                    viewCount: 2,
                    owner: user,
                }),
            ])
        );
    });

    it('create with base all defaults', async () => {
        const { enhance } = await loadSchema(
            `
            model Base {
                id Int @id @default(autoincrement())
                createdAt DateTime @default(now())
                type String

                @@delegate(type)
            }

            model Foo extends Base {
                name String
            }
            `,
            { logPrismaQuery: true, enhancements: ['delegate'] }
        );

        const db = enhance();
        const r = await db.foo.create({ data: { name: 'foo' } });
        expect(r).toMatchObject({ name: 'foo', type: 'Foo', id: expect.any(Number), createdAt: expect.any(Date) });
    });

    it('create with nesting', async () => {
        const { enhance } = await loadSchema(schema, { logPrismaQuery: true, enhancements: ['delegate'] });
        const db = enhance();

        // nested create a relation from base
        await expect(
            db.ratedVideo.create({
                data: { owner: { create: { id: 2 } }, url: 'xyz', rating: 200, duration: 200 },
                include: { owner: true },
            })
        ).resolves.toMatchObject({ owner: { id: 2 } });
    });

    it('read with concrete', async () => {
        const { db, user, video } = await setup();

        // find with include
        let found = await db.ratedVideo.findFirst({ include: { owner: true } });
        expect(found).toMatchObject(video);
        expect(found.owner).toMatchObject(user);

        // find with select
        found = await db.ratedVideo.findFirst({ select: { id: true, createdAt: true, url: true, rating: true } });
        expect(found).toMatchObject({ id: video.id, createdAt: video.createdAt, url: video.url, rating: video.rating });

        // findFirstOrThrow
        found = await db.ratedVideo.findFirstOrThrow();
        expect(found).toMatchObject(video);
        await expect(
            db.ratedVideo.findFirstOrThrow({
                where: { id: video.id + 1 },
            })
        ).rejects.toThrow();

        // findUnique
        found = await db.ratedVideo.findUnique({
            where: { id: video.id },
        });
        expect(found).toMatchObject(video);

        // findUniqueOrThrow
        found = await db.ratedVideo.findUniqueOrThrow({
            where: { id: video.id },
        });
        expect(found).toMatchObject(video);
        await expect(
            db.ratedVideo.findUniqueOrThrow({
                where: { id: video.id + 1 },
            })
        ).rejects.toThrow();

        // findMany
        let items = await db.ratedVideo.findMany();
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject(video);

        // findMany not found
        items = await db.ratedVideo.findMany({ where: { id: video.id + 1 } });
        expect(items).toHaveLength(0);

        // findMany with select
        items = await db.ratedVideo.findMany({ select: { id: true, createdAt: true, url: true, rating: true } });
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: video.id,
            createdAt: video.createdAt,
            url: video.url,
            rating: video.rating,
        });

        // find with base filter
        found = await db.ratedVideo.findFirst({ where: { viewCount: video.viewCount } });
        expect(found).toMatchObject(video);
        found = await db.ratedVideo.findFirst({ where: { url: video.url, owner: { id: user.id } } });
        expect(found).toMatchObject(video);

        // image: single inheritance
        const image = await db.image.create({
            data: { owner: { connect: { id: 1 } }, viewCount: 1, format: 'png' },
            include: { owner: true },
        });
        const readImage = await db.image.findFirst({ include: { owner: true } });
        expect(readImage).toMatchObject(image);
        expect(readImage.owner).toMatchObject(user);
    });

    it('read with base', async () => {
        const { db, user, video: r } = await setup();

        let video = await db.video.findFirst({ where: { duration: r.duration }, include: { owner: true } });
        expect(video).toMatchObject({
            id: video.id,
            createdAt: r.createdAt,
            viewCount: r.viewCount,
            url: r.url,
            duration: r.duration,
            assetType: 'Video',
            videoType: 'RatedVideo',
        });
        expect(video.rating).toBeUndefined();
        expect(video.owner).toMatchObject(user);

        const asset = await db.asset.findFirst({ where: { viewCount: r.viewCount }, include: { owner: true } });
        expect(asset).toMatchObject({ id: r.id, createdAt: r.createdAt, assetType: 'Video', viewCount: r.viewCount });
        expect(asset.url).toBeUndefined();
        expect(asset.duration).toBeUndefined();
        expect(asset.rating).toBeUndefined();
        expect(asset.videoType).toBeUndefined();
        expect(asset.owner).toMatchObject(user);

        const image = await db.image.create({
            data: { owner: { connect: { id: 1 } }, viewCount: 1, format: 'png' },
            include: { owner: true },
        });
        const imgAsset = await db.asset.findFirst({ where: { assetType: 'Image' }, include: { owner: true } });
        expect(imgAsset).toMatchObject({
            id: image.id,
            createdAt: image.createdAt,
            assetType: 'Image',
            viewCount: image.viewCount,
        });
        expect(imgAsset.format).toBeUndefined();
        expect(imgAsset.owner).toMatchObject(user);
    });

    it('update simple', async () => {
        const { db, videoWithOwner: video } = await setup();

        // update with concrete
        let updated = await db.ratedVideo.update({
            where: { id: video.id },
            data: { rating: 200 },
            include: { owner: true },
        });
        expect(updated.rating).toBe(200);
        expect(updated.owner).toBeTruthy();

        // update with base
        updated = await db.video.update({
            where: { id: video.id },
            data: { duration: 200 },
            select: { duration: true, createdAt: true },
        });
        expect(updated.duration).toBe(200);
        expect(updated.createdAt).toBeTruthy();

        // update with base
        updated = await db.asset.update({
            where: { id: video.id },
            data: { viewCount: 200 },
        });
        expect(updated.viewCount).toBe(200);

        // set discriminator
        await expect(db.ratedVideo.update({ where: { id: video.id }, data: { assetType: 'Image' } })).rejects.toThrow(
            'is a discriminator'
        );
        await expect(
            db.ratedVideo.update({ where: { id: video.id }, data: { videoType: 'RatedVideo' } })
        ).rejects.toThrow('is a discriminator');
    });

    it('update nested', async () => {
        const { db, videoWithOwner: video, user } = await setup();

        // create delegate not allowed
        await expect(
            db.user.update({
                where: { id: user.id },
                data: {
                    assets: {
                        create: { viewCount: 1 },
                    },
                },
                include: { assets: true },
            })
        ).rejects.toThrow('is a delegate');

        // create concrete
        await expect(
            db.user.update({
                where: { id: user.id },
                data: {
                    ratedVideos: {
                        create: {
                            viewCount: 1,
                            duration: 100,
                            url: 'xyz',
                            rating: 100,
                            owner: { connect: { id: user.id } },
                        },
                    },
                },
                include: { ratedVideos: true },
            })
        ).resolves.toMatchObject({
            ratedVideos: expect.arrayContaining([
                expect.objectContaining({ viewCount: 1, duration: 100, url: 'xyz', rating: 100 }),
            ]),
        });

        // update
        let updated = await db.asset.update({
            where: { id: video.id },
            data: { owner: { update: { level: 1 } } },
            include: { owner: true },
        });
        expect(updated.owner.level).toBe(1);

        updated = await db.video.update({
            where: { id: video.id },
            data: { duration: 300, owner: { update: { level: 2 } } },
            include: { owner: true },
        });
        expect(updated.duration).toBe(300);
        expect(updated.owner.level).toBe(2);

        updated = await db.ratedVideo.update({
            where: { id: video.id },
            data: { rating: 300, owner: { update: { level: 3 } } },
            include: { owner: true },
        });
        expect(updated.rating).toBe(300);
        expect(updated.owner.level).toBe(3);

        // updateMany
        await db.user.update({
            where: { id: user.id },
            data: {
                ratedVideos: {
                    create: { url: 'xyz', duration: 111, rating: 222, owner: { connect: { id: user.id } } },
                },
            },
        });
        await expect(
            db.user.update({
                where: { id: user.id },
                data: { ratedVideos: { updateMany: { where: { duration: 111 }, data: { rating: 333 } } } },
                include: { ratedVideos: true },
            })
        ).resolves.toMatchObject({ ratedVideos: expect.arrayContaining([expect.objectContaining({ rating: 333 })]) });

        // delete with base
        await db.user.update({
            where: { id: user.id },
            data: { assets: { delete: { id: video.id } } },
        });
        await expect(db.asset.findUnique({ where: { id: video.id } })).resolves.toBeNull();
        await expect(db.video.findUnique({ where: { id: video.id } })).resolves.toBeNull();
        await expect(db.ratedVideo.findUnique({ where: { id: video.id } })).resolves.toBeNull();

        // delete with concrete
        const u = await db.user.update({
            where: { id: user.id },
            data: {
                ratedVideos: {
                    create: { url: 'xyz', duration: 111, rating: 222, owner: { connect: { id: user.id } } },
                },
            },
            include: { ratedVideos: true },
        });
        const vid = u.ratedVideos[0].id;
        await db.user.update({
            where: { id: user.id },
            data: { ratedVideos: { delete: { id: vid } } },
        });
        await expect(db.asset.findUnique({ where: { id: vid } })).resolves.toBeNull();
        await expect(db.video.findUnique({ where: { id: vid } })).resolves.toBeNull();
        await expect(db.ratedVideo.findUnique({ where: { id: vid } })).resolves.toBeNull();

        // nested create a relation from base
        const newVideo = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, duration: 100, url: 'xyz', rating: 100 },
        });
        await expect(
            db.ratedVideo.update({
                where: { id: newVideo.id },
                data: { owner: { create: { id: 2 } }, url: 'xyz', duration: 200, rating: 200 },
                include: { owner: true },
            })
        ).resolves.toMatchObject({ owner: { id: 2 } });
    });

    it('updateMany', async () => {
        const { db, videoWithOwner: video, user } = await setup();
        const otherVideo = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 10000, duration: 10000, url: 'xyz', rating: 10000 },
        });

        // update only the current level
        await expect(
            db.ratedVideo.updateMany({
                where: { rating: video.rating, viewCount: video.viewCount },
                data: { rating: 100 },
            })
        ).resolves.toMatchObject({ count: 1 });
        let read = await db.ratedVideo.findUnique({ where: { id: video.id } });
        expect(read).toMatchObject({ rating: 100 });

        // update with concrete
        await expect(
            db.ratedVideo.updateMany({
                where: { id: video.id },
                data: { viewCount: 1, duration: 11, rating: 101 },
            })
        ).resolves.toMatchObject({ count: 1 });
        read = await db.ratedVideo.findUnique({ where: { id: video.id } });
        expect(read).toMatchObject({ viewCount: 1, duration: 11, rating: 101 });

        // update with base
        await db.video.updateMany({
            where: { viewCount: 1, duration: 11 },
            data: { viewCount: 2, duration: 12 },
        });
        read = await db.ratedVideo.findUnique({ where: { id: video.id } });
        expect(read).toMatchObject({ viewCount: 2, duration: 12 });

        // update with base
        await db.asset.updateMany({
            where: { viewCount: 2 },
            data: { viewCount: 3 },
        });
        read = await db.ratedVideo.findUnique({ where: { id: video.id } });
        expect(read.viewCount).toBe(3);

        // the other video is unchanged
        await expect(await db.ratedVideo.findUnique({ where: { id: otherVideo.id } })).toMatchObject(otherVideo);

        // update with concrete no where
        await expect(
            db.ratedVideo.updateMany({
                data: { viewCount: 111, duration: 111, rating: 111 },
            })
        ).resolves.toMatchObject({ count: 2 });
        await expect(db.ratedVideo.findUnique({ where: { id: video.id } })).resolves.toMatchObject({ duration: 111 });
        await expect(db.ratedVideo.findUnique({ where: { id: otherVideo.id } })).resolves.toMatchObject({
            duration: 111,
        });

        // set discriminator
        await expect(db.ratedVideo.updateMany({ data: { assetType: 'Image' } })).rejects.toThrow('is a discriminator');
        await expect(db.ratedVideo.updateMany({ data: { videoType: 'RatedVideo' } })).rejects.toThrow(
            'is a discriminator'
        );
    });

    it('upsert', async () => {
        const { db, videoWithOwner: video, user } = await setup();

        await expect(
            db.asset.upsert({
                where: { id: video.id },
                create: { id: video.id, viewCount: 1 },
                update: { viewCount: 2 },
            })
        ).rejects.toThrow('is a delegate');

        // update
        await expect(
            db.ratedVideo.upsert({
                where: { id: video.id },
                create: {
                    viewCount: 1,
                    duration: 300,
                    url: 'xyz',
                    rating: 100,
                    owner: { connect: { id: user.id } },
                },
                update: { duration: 200 },
            })
        ).resolves.toMatchObject({
            id: video.id,
            duration: 200,
        });

        // create
        const created = await db.ratedVideo.upsert({
            where: { id: video.id + 1 },
            create: { viewCount: 1, duration: 300, url: 'xyz', rating: 100, owner: { connect: { id: user.id } } },
            update: { duration: 200 },
        });
        expect(created.id).not.toEqual(video.id);
        expect(created.duration).toBe(300);
    });

    it('delete', async () => {
        let { db, user, video: ratedVideo } = await setup();

        let deleted = await db.ratedVideo.delete({
            where: { id: ratedVideo.id },
            select: { rating: true, owner: true },
        });
        expect(deleted).toMatchObject({ rating: 100 });
        expect(deleted.owner).toMatchObject(user);
        await expect(db.ratedVideo.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();
        await expect(db.video.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();
        await expect(db.asset.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();

        // delete with base
        ratedVideo = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, duration: 100, url: 'xyz', rating: 100 },
        });
        const video = await db.video.findUnique({ where: { id: ratedVideo.id } });
        deleted = await db.video.delete({ where: { id: ratedVideo.id }, include: { owner: true } });
        expect(deleted).toMatchObject(video);
        expect(deleted.owner).toMatchObject(user);
        await expect(db.ratedVideo.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();
        await expect(db.video.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();
        await expect(db.asset.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();

        ratedVideo = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, duration: 100, url: 'xyz', rating: 100 },
        });
        const asset = await db.asset.findUnique({ where: { id: ratedVideo.id } });
        deleted = await db.video.delete({ where: { id: ratedVideo.id }, include: { owner: true } });
        expect(deleted).toMatchObject(asset);
        expect(deleted.owner).toMatchObject(user);
        await expect(db.ratedVideo.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();
        await expect(db.video.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();
        await expect(db.asset.findUnique({ where: { id: ratedVideo.id } })).resolves.toBeNull();
    });

    it('deleteMany', async () => {
        const { enhance } = await loadSchema(schema, { logPrismaQuery: true, enhancements: ['delegate'] });
        const db = enhance();

        const user = await db.user.create({ data: { id: 1 } });

        const video1 = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, duration: 100, url: 'xyz', rating: 100 },
        });
        const video2 = await db.ratedVideo.create({
            data: { owner: { connect: { id: user.id } }, viewCount: 1, duration: 100, url: 'xyz', rating: 100 },
        });

        // no where
        await expect(db.ratedVideo.deleteMany()).resolves.toMatchObject({ count: 2 });
        await expect(db.ratedVideo.findUnique({ where: { id: video1.id } })).resolves.toBeNull();
        await expect(db.video.findUnique({ where: { id: video1.id } })).resolves.toBeNull();
        await expect(db.asset.findUnique({ where: { id: video1.id } })).resolves.toBeNull();
        await expect(db.ratedVideo.findUnique({ where: { id: video2.id } })).resolves.toBeNull();
        await expect(db.video.findUnique({ where: { id: video2.id } })).resolves.toBeNull();
        await expect(db.asset.findUnique({ where: { id: video2.id } })).resolves.toBeNull();

        // where current level

        // where with base level
    });

    it('aggregate', async () => {
        const { db } = await setup();

        const aggregate = await db.ratedVideo.aggregate({
            _count: true,
            _sum: { rating: true },
            where: { viewCount: { gt: 0 }, rating: { gt: 10 } },
            orderBy: {
                duration: 'desc',
            },
        });
        expect(aggregate).toMatchObject({ _count: 1, _sum: { rating: 100 } });

        expect(() => db.ratedVideo.aggregate({ _count: true, _sum: { rating: true, viewCount: true } })).toThrow(
            'aggregate with fields from base type is not supported yet'
        );
    });

    it('count', async () => {
        const { db } = await setup();

        let count = await db.ratedVideo.count();
        expect(count).toBe(1);

        count = await db.ratedVideo.count({
            select: { _all: true, rating: true },
            where: { viewCount: { gt: 0 }, rating: { gt: 10 } },
        });
        expect(count).toMatchObject({ _all: 1, rating: 1 });

        expect(() => db.ratedVideo.count({ select: { rating: true, viewCount: true } })).toThrow(
            'count with fields from base type is not supported yet'
        );
    });

    it('groupBy', async () => {
        const { db, video } = await setup();

        let group = await db.ratedVideo.groupBy({ by: ['rating'] });
        expect(group).toHaveLength(1);
        expect(group[0]).toMatchObject({ rating: video.rating });

        group = await db.ratedVideo.groupBy({
            by: ['id', 'rating'],
            where: { viewCount: { gt: 0 }, rating: { gt: 10 } },
        });
        expect(group).toHaveLength(1);
        expect(group[0]).toMatchObject({ id: video.id, rating: video.rating });

        group = await db.ratedVideo.groupBy({
            by: ['id'],
            _sum: { rating: true },
        });
        expect(group).toHaveLength(1);
        expect(group[0]).toMatchObject({ id: video.id, _sum: { rating: video.rating } });

        group = await db.ratedVideo.groupBy({
            by: ['id'],
            _sum: { rating: true },
            having: { rating: { _sum: { gt: video.rating } } },
        });
        expect(group).toHaveLength(0);

        expect(() => db.ratedVideo.groupBy({ by: 'viewCount' })).toThrow(
            'groupBy with fields from base type is not supported yet'
        );
        expect(() => db.ratedVideo.groupBy({ having: { rating: { gt: 0 }, viewCount: { gt: 0 } } })).toThrow(
            'groupBy with fields from base type is not supported yet'
        );
    });
});
